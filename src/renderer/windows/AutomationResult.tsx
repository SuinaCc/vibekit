import { createSignal, onCleanup, onMount, Show } from 'solid-js';
import type { AutomationRun } from '@shared';
import MiniDragStrip from '../components/MiniDragStrip';
import './automation-result.css';

function getRunId(): string {
  const params = new URLSearchParams(window.location.hash.split('?')[1] || '');
  return params.get('runId') || '';
}

function statusLabel(run: AutomationRun | null): string {
  if (!run) return '读取中';
  if (run.status === 'running') return '执行中';
  if (run.status === 'error') return '执行失败';
  return '执行完成';
}

function ipcErrorMessage(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  return message.replace(/^Error invoking remote method '[^']+': (?:Error: )?/, '');
}

export default function AutomationResult() {
  const [runId, setRunId] = createSignal(getRunId());
  const [run, setRun] = createSignal<AutomationRun | null>(null);
  const [missing, setMissing] = createSignal(false);
  const [copied, setCopied] = createSignal(false);
  const [now, setNow] = createSignal(Date.now());
  let copyTimer: ReturnType<typeof setTimeout> | undefined;

  const load = async (id: string) => {
    if (!id) {
      setMissing(true);
      return;
    }
    try {
      const data = await window.vibekitAPI?.automation.getRun(id);
      if (!data) {
        setMissing(true);
        return;
      }
      setMissing(false);
      setRun(data);
    } catch {
      setMissing(true);
    }
  };

  const resetCopy = () => {
    if (copyTimer) clearTimeout(copyTimer);
    setCopied(false);
  };

  onMount(() => {
    void load(runId());

    const unsubRun = window.vibekitAPI?.onEvent('vibekit:automation-run', (payload: unknown) => {
      const next = payload as AutomationRun | undefined;
      if (!next || next.id !== runId()) return;
      setRun(next);
      setMissing(false);
    });
    const unsubFocus = window.vibekitAPI?.onEvent('vibekit:automation-focus-run', (payload: unknown) => {
      if (typeof payload !== 'string') return;
      resetCopy();
      setRun(null);
      setRunId(payload);
      void load(payload);
    });

    const timer = setInterval(() => setNow(Date.now()), 250);

    onCleanup(() => {
      if (unsubRun) unsubRun();
      if (unsubFocus) unsubFocus();
      clearInterval(timer);
      if (copyTimer) clearTimeout(copyTimer);
    });
  });

  const copyOutput = async () => {
    const data = run();
    if (!data?.output) return;
    await window.vibekitAPI?.system.writeClipboard(data.output);
    setCopied(true);
    if (copyTimer) clearTimeout(copyTimer);
    copyTimer = setTimeout(() => setCopied(false), 1800);
  };

  const rerun = async () => {
    const data = run();
    if (!data) return;
    try {
      await window.vibekitAPI?.automation.startFromSearch(data.commandId, data.args);
    } catch (error) {
      window.vibekitAPI?.system.showNotification('自动化助手', ipcErrorMessage(error));
    }
  };

  const elapsed = () => {
    const data = run();
    if (!data) return 0;
    return Math.max(0, (data.finishedAt ?? now()) - data.startedAt);
  };

  const outputLines = () => {
    const text = run()?.output || '';
    return text ? text.split(/\r?\n/).length : 0;
  };

  return (
    <div class="ar-root">
      <div class="ar-panel">
        <MiniDragStrip class="mini-drag-strip" />
        <div class="ar-glow" />

        <header class="ar-header">
          <div class="ar-brand-row">
            <div class="ar-brand">
              <span class="ar-bolt">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                  <path d="M13 2 4.6 13.2A.5.5 0 0 0 5 14h5.4l-1.6 8 8.6-11.2a.5.5 0 0 0-.4-.8h-5.5z" />
                </svg>
              </span>
              自动化助手
              <span class={`ar-status ${run()?.status ?? 'loading'}`}>
                <span class="ar-status-dot" />
                {statusLabel(run())}
              </span>
            </div>
            <button
              class="ar-close no-drag"
              onClick={() => window.vibekitAPI?.window.closeCurrent()}
              title="关闭 (Esc)"
              aria-label="关闭"
            >
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <path d="M18 6 6 18" />
                <path d="m6 6 12 12" />
              </svg>
            </button>
          </div>

          <Show when={run()}>
            {(data) => (
              <>
                <div class="ar-command-row">
                  <span class="ar-prompt">›</span>
                  <span class="ar-command">{data().token}</span>
                  <span class="ar-args">{data().args}</span>
                </div>
                <div class="ar-meta-row">
                  <span>{data().name}</span>
                  <span class="ar-meta-sep">·</span>
                  <span>{new Date(data().startedAt).toLocaleTimeString('zh-CN', { hour12: false })}</span>
                  <Show when={data().status !== 'running'}>
                    <span class="ar-meta-sep">·</span>
                    <span>{(elapsed() / 1000).toFixed(elapsed() < 10_000 ? 2 : 1)} s</span>
                  </Show>
                  <Show when={data().autoCopied}>
                    <span class="ar-copied-chip">
                      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round">
                        <path d="m5 12 4 4L19 6" />
                      </svg>
                      已自动复制
                    </span>
                  </Show>
                </div>
              </>
            )}
          </Show>
        </header>

        <main class="ar-body">
          <Show when={missing()}>
            <div class="ar-empty">
              <div class="ar-empty-icon">!</div>
              <div>找不到这次执行记录</div>
              <div class="ar-empty-hint">结果可能已被清理，请重新运行命令。</div>
            </div>
          </Show>

          <Show when={!missing()}>
            <div class="ar-output-card">
              <div class="ar-output-head">
                <span>输出</span>
                <span class="ar-output-count">
                  {run()?.status === 'running' ? '等待脚本返回…' : outputLines() ? `${outputLines()} 行` : '无输出'}
                </span>
              </div>

              <Show when={run()?.status === 'running'}>
                <div class="ar-running">
                  <div class="ar-spinner" />
                  <div class="ar-running-text">正在执行命令</div>
                  <div class="ar-skeleton-list" aria-hidden="true">
                    <span style="width: 72%" />
                    <span style="width: 48%" />
                    <span style="width: 61%" />
                  </div>
                </div>
              </Show>

              <Show when={run() && run()!.status !== 'running'}>
                <Show when={run()!.error}>
                  <div class="ar-error">
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                      <circle cx="12" cy="12" r="9" />
                      <path d="M12 8v4.5" />
                      <path d="M12 16h.01" />
                    </svg>
                    <span>{run()!.error}</span>
                  </div>
                </Show>
                <pre class="ar-output">{run()!.output || (run()!.error ? '脚本没有返回内容。' : '执行完成，没有输出。')}</pre>
              </Show>
            </div>
          </Show>
        </main>

        <footer class="ar-footer">
          <button
            class="ar-btn ar-btn-primary"
            disabled={!run()?.output || run()?.status === 'running'}
            onClick={copyOutput}
          >
            <Show
              when={copied()}
              fallback={
                <>
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                    <rect x="9" y="9" width="12" height="12" rx="2" />
                    <path d="M5 15V5a2 2 0 0 1 2-2h10" />
                  </svg>
                  复制结果
                </>
              }
            >
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round">
                <path d="m5 12 4 4L19 6" />
              </svg>
              已复制
            </Show>
          </button>
          <button class="ar-btn" disabled={!run() || run()?.status === 'running'} onClick={rerun}>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <path d="M21 12a9 9 0 1 1-2.6-6.4" />
              <path d="M21 3v6h-6" />
            </svg>
            重新运行
          </button>
          <span class="ar-foot-hint">
            <kbd>Esc</kbd> 关闭
          </span>
        </footer>
      </div>
    </div>
  );
}
