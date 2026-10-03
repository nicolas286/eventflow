import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import remarkBreaks from "remark-breaks";
import "./MarkdownText.css";

type Props = {
  markdown: string | null | undefined;
  className?: string;
};

export default function MarkdownText({ markdown, className }: Props) {
  const md = (markdown ?? "").trim();
  if (!md) return null;

  return (
    <div className={["markdownText", className].filter(Boolean).join(" ")}>
      <ReactMarkdown
        remarkPlugins={[remarkGfm, remarkBreaks]}
        skipHtml
        components={{
          a: ({ ...props }) => (
            <a {...props} target="_blank" rel="noopener noreferrer" />
          ),
        }}
      >
        {md}
      </ReactMarkdown>
    </div>
  );
}
