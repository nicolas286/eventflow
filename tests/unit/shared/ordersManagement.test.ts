import { afterEach, describe, expect, it, vi } from "vitest";
import { createClient } from "@supabase/supabase-js";
import ExcelJS from "exceljs";
import { makeEventAdminOrdersViewRepo } from "../../../src/app/modules/admin/orders/data/makeEventAdminOrdersViewRepo";
import { makeSearchEventAdminOrdersViewRepo } from "../../../src/app/modules/admin/orders/data/admin.searchEventOrdersViewRepo";
import { makeEventTicketsAdminSearchRepo } from "../../../src/app/modules/admin/orders/data/admin.searchEventTicketsViewRepo";
import { makeEventParticipantsExportRepo } from "../../../src/app/modules/admin/orders/data/makeEventParticipantsExportRepo";
import { adminUpdateOrderAttendeeRepo } from "../../../src/app/modules/admin/orders/data/updateOrderAttendeeRepo";
import { deleteOrderRepo } from "../../../src/app/modules/admin/orders/data/deleteOrderRepo";
import { bankTransferAdminRepo } from "../../../src/app/modules/admin/orders/data/bankTransferAdminRepo";
import { exportParticipantsXls } from "../../../src/app/modules/admin/orders/helpers/exportParticipantsXls";
import { createAdminSingleEventOrdersViewStore } from "../../../src/app/modules/admin/orders/hooks/useMakeEventAdminOrdersView";
import { createSearchEventAdminOrdersViewStore } from "../../../src/app/modules/admin/orders/hooks/useSearchEventOrdersView";
import { createSearchEventAdminTicketsStore } from "../../../src/app/modules/admin/orders/hooks/useSearchEventTicketsView";
import { createBankTransferReadStore } from "../../../src/app/modules/admin/orders/hooks/useBankTransferAdmin";
import { adminUpdateOrderAttendeeInputSchema, ordersListRequestSchema } from "../../../shared/schemas/orders-management";
vi.mock("@providers/AuthProvider/useAuth",()=>({useAuth:()=>({session:null})}));
const id="b3200000-0000-4000-8000-000000000001", next="b3200000-0000-4000-8000-000000000002";
const empty={orders:{limit:50,offset:0,total:0,rows:[]},orderItems:[],payments:[],attendees:[],attendeeAnswers:[]};
const attendee={id,orderId:id,productNameSnapshot:"=HYPERLINK(\"evil\")",attendeeIndex:1,createdAt:"2026-10-03",status:"confirmed"} as const;
function fixture(){
 const client=createClient("https://b3.invalid","synthetic-public",{auth:{persistSession:false,autoRefreshToken:false}});
 const functions=client.functions;vi.spyOn(client,"functions","get").mockReturnValue(functions);
 return{client,invoke:vi.spyOn(functions,"invoke"),rpc:vi.spyOn(client,"rpc"),from:vi.spyOn(client,"from")};
}
afterEach(()=>{vi.restoreAllMocks();vi.unstubAllGlobals();});
describe("B3 frontend routes and strict contracts",()=>{
 it("preserves list/search/ticket paging and never calls a direct RPC",async()=>{
  const f=fixture();f.invoke.mockResolvedValue({data:empty,error:null});
  await makeEventAdminOrdersViewRepo(f.client).getEventAdminOrdersView({eventId:id,ordersLimit:25,ordersOffset:50});
  expect(f.invoke).toHaveBeenLastCalledWith("orders/admin/list",{body:{eventId:id,ordersLimit:25,ordersOffset:50}});
  await makeSearchEventAdminOrdersViewRepo(f.client).searchEventAdminOrdersView({orgId:id,eventSlug:"same",query:"needle",filterMode:"field:first_name"});
  expect(f.invoke).toHaveBeenLastCalledWith("orders/admin/search",{body:{orgId:id,eventSlug:"same",query:"needle",filterMode:"field:first_name",ordersLimit:50,ordersOffset:0}});
  f.invoke.mockResolvedValue({data:{tickets:{limit:50,offset:0,total:0,rows:[]}},error:null});
  await makeEventTicketsAdminSearchRepo(f.client).searchEventTicketsAdmin({eventId:id,query:"needle"});
  expect(f.invoke).toHaveBeenLastCalledWith("orders/admin/tickets-search",{body:{eventId:id,query:"needle",limit:50,offset:0}});
  expect(f.rpc).not.toHaveBeenCalled();expect(f.from).not.toHaveBeenCalled();
 });
 it("collects all export pages and forwards the precise SQL cursor",async()=>{
  const f=fixture(),cursor={after:id,through:next,snapshot:"2026-10-03T12:00:00.123456+00:00"};
  f.invoke.mockResolvedValueOnce({data:{...empty,attendees:[attendee],nextCursor:cursor},error:null}).mockResolvedValueOnce({data:{...empty,attendees:[{...attendee,id:next}],nextCursor:null},error:null});
  const result=await makeEventParticipantsExportRepo(f.client).getEventParticipantsExportData({eventId:id,confirmedOnly:false});
  expect(result.attendees.map(a=>a.id)).toEqual([id,next]);expect(f.invoke).toHaveBeenLastCalledWith("orders/admin/participants-export",{body:{eventId:id,confirmedOnly:false,limit:100,cursor}});
  expect(f.rpc).not.toHaveBeenCalled();
 });
 it("rejects a repeated export cursor instead of silently truncating or looping",async()=>{
  const f=fixture(),cursor={after:id,through:next,snapshot:"2026-10-03T12:00:00Z"};
  f.invoke.mockResolvedValue({data:{...empty,nextCursor:cursor},error:null});
  await expect(makeEventParticipantsExportRepo(f.client).getEventParticipantsExportData({eventId:id})).rejects.toThrow("EXPORT_CURSOR_INVALID");
 });
 it("keeps business JSON bytes/keys intact through participant updates",async()=>{
  const f=fixture(),value={value_text:" unchanged ",Nested_Key:{CamelKey:1,snake_key:true}};
  f.invoke.mockResolvedValue({data:{attendeeId:id,updatedAnswersCount:1},error:null});
  await adminUpdateOrderAttendeeRepo(f.client).updateOrderAttendee({attendeeId:id,attendee:{answers:[{fieldKey:"identity",value}]}});
  expect(f.invoke).toHaveBeenLastCalledWith("orders/admin/participant-update",{body:{attendeeId:id,attendee:{answers:[{fieldKey:"identity",value}]}}});expect(f.rpc).not.toHaveBeenCalled();
 });
 it("validates deletion/expiration acknowledgements and assembles bank pages",async()=>{
  const f=fixture();f.invoke.mockResolvedValue({data:{deleted_order_id:id,released:{sold_units:1,reserved_units:0}},error:null});
  await deleteOrderRepo(f.client).deleteOrder({id});expect(f.invoke).toHaveBeenLastCalledWith("orders/admin/delete",{body:{orderId:id}});
  f.invoke.mockResolvedValue({data:{ok:true,orderId:id,status:"expired",releasedUnits:0,idempotent:true},error:null});
  await bankTransferAdminRepo(f.client).expire(id);expect(f.invoke).toHaveBeenLastCalledWith("orders/admin/bank-expire",{body:{orderId:id,eventId:undefined}});
  f.invoke.mockResolvedValue({data:{items:[],nextAfter:null},error:null});expect(await bankTransferAdminRepo(f.client).list(id)).toEqual([]);
  expect(f.invoke).toHaveBeenLastCalledWith("orders/admin/bank-summaries",{body:{eventId:id,limit:100,after:null}});expect(f.rpc).not.toHaveBeenCalled();
 });
 it("rejects system fields, ignored identity fields and inconsistent references",()=>{
  for(const extra of [{status:"paid"},{priceCents:1},{orderId:next},{email:"ignored@example.test"}])expect(adminUpdateOrderAttendeeInputSchema.safeParse({attendeeId:id,attendee:{answers:[],...extra}}).success).toBe(false);
  expect(adminUpdateOrderAttendeeInputSchema.safeParse({attendeeId:id,attendee:{answers:[{fieldKey:"name",paidCents:2}]}}).success).toBe(false);
  expect(ordersListRequestSchema.safeParse({eventId:id,eventSlug:"foreign"}).success).toBe(false);
 });
 it.each([403,429,503])("propagates Edge %i without a direct fallback",async status=>{
  const f=fixture();f.invoke.mockResolvedValue({data:null,error:{name:"FunctionsHttpError",message:"safe",context:new Response(JSON.stringify({error:status===429?"TOO_MANY_REQUESTS":"FORBIDDEN"}),{status})}});
  await expect(makeEventAdminOrdersViewRepo(f.client).getEventAdminOrdersView({eventId:id})).rejects.toThrow();expect(f.rpc).not.toHaveBeenCalled();
 });
});
describe("B3 stale reads and XLSX cell safety",()=>{
 it("keeps bank summaries on refresh/error and clears abandoned scopes",async()=>{
  const item={orderId:id,amountCents:100,currency:"EUR",internalReference:"B3",communication:null,createdAt:"2026-10-03",paymentDueAt:null,confirmedAt:null,confirmedBy:null};
  let fail=false;
  const store=createBankTransferReadStore(async()=>{if(fail)throw new Error("refresh failed");return[item];},true);
  const off=store.subscribe(()=>{});await Promise.resolve();expect(store.getSnapshot().summaries).toEqual([item]);
  fail=true;await store.refresh();expect(store.getSnapshot().summaries).toEqual([item]);expect(store.getSnapshot().error).toBeTruthy();
  off();expect(store.getSnapshot().summaries).toEqual([]);
 });
 it("invalidates abandoned/older requests for each migrated read store",async()=>{
  for(const factory of [createAdminSingleEventOrdersViewStore,createSearchEventAdminOrdersViewStore]){
   let resolve:(value:{data:typeof empty})=>void=()=>{};
   const store=factory(()=>new Promise(r=>{resolve=r;}),true),off=store.subscribe(()=>{});
   off();resolve({data:empty});await Promise.resolve();expect(store.getSnapshot().data).toBeNull();
  }
  let resolve:(value:{data:{tickets:{limit:number;offset:number;total:number;rows:[]}}})=>void=()=>{};
  const store=createSearchEventAdminTicketsStore(()=>new Promise(r=>{resolve=r;}),true),off=store.subscribe(()=>{});
  off();resolve({data:{tickets:{limit:50,offset:0,total:0,rows:[]}}});await Promise.resolve();expect(store.getSnapshot().data).toBeNull();
 });
 it("serializes user formula prefixes as literal strings in the actual XLSX",async()=>{
  let blob:Blob|null=null;
  vi.spyOn(URL,"createObjectURL").mockImplementation(value=>{if(value instanceof Blob)blob=value;return"blob:synthetic";});vi.spyOn(URL,"revokeObjectURL").mockImplementation(()=>{});
  const click=vi.fn();vi.stubGlobal("document",{createElement:()=>({click,href:"",download:""})});
  const values=["=1+2","+cmd","-cmd","@cmd","\t=1+2"];
  const fields=values.map((label,i)=>({id,eventId:id,fieldKey:`field_${i}`,label,fieldType:"text",isRequired:false,isActive:true,sortOrder:i,createdAt:"2026-10-03",updatedAt:"2026-10-03"} as const));
  await exportParticipantsXls({localAttendees:[attendee],regFields:fields,filledFieldsByAttendeeId:new Map([[id,values.map((value,i)=>({key:`field_${i}`,value}))]]),computeIdentityTitle:()=>"same"});
  expect(click).toHaveBeenCalledOnce();if(!blob)throw new Error("Missing workbook");
  const data:Blob=blob;const workbook=new ExcelJS.Workbook();await workbook.xlsx.load(await data.arrayBuffer());
  const cell=workbook.getWorksheet("Participants")?.getCell("C2");expect(cell?.type).toBe(ExcelJS.ValueType.String);expect(cell?.value).toBe(attendee.productNameSnapshot);
  for(let i=0;i<values.length;i++){const valueCell=workbook.getWorksheet("Participants")?.getCell(2,5+i);expect(valueCell?.type).toBe(ExcelJS.ValueType.String);expect(valueCell?.value).toBe(values[i]);}
 });
});
