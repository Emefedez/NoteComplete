// Stop a child process cleanly with SIGTERM, then escalate to SIGKILL if
// it hangs or deadlocks during shutdown. Shared by ai-runner.js and transcriber.js.
export function terminateProcess(child, graceMs = 4000) {
  if (!child) return;
  try { child.kill('SIGTERM'); } catch {}
  const timer = setTimeout(() => {
    try {
      if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL');
    } catch {}
  }, graceMs);
  child.once('close', () => clearTimeout(timer));
}
