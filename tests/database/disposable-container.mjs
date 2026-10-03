// SQL recipes may mutate only the dedicated local stack or an explicit CI stack.
export function assertDisposableOrganizerContainer(container) {
  const isolated = /^supabase_db_eventflow-security-(?:b1b2|b3|b4|b5|b6)-[a-zA-Z0-9-]+$/.test(container ?? '');
  const ci = process.argv.includes('--ci') && process.env.CI === 'true'
    && process.env.GITHUB_ACTIONS === 'true' && container === 'supabase_db_eventflow-front';
  if (!isolated && !ci) {
    throw new Error('Pass a dedicated disposable B1–B6 container, or the explicit GitHub Actions CI container with --ci');
  }
}
