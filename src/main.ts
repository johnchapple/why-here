import '@fontsource/im-fell-english/400.css';
import '@fontsource/im-fell-english/400-italic.css';
import '@fontsource/im-fell-english-sc/400.css';
import './styles.css';
import { App } from './ui/app';
import { sandboxMode, START_PARAMS } from './ui/sandbox';

async function main() {
  const app = new App(document.getElementById('app')!);
  (window as unknown as { app: App }).app = app;
  const modes: Record<string, () => Promise<void> | void> = {
    sandbox: async () => {
      app.editingAllowed = true;
      app.setMode(sandboxMode(app));
      if (!app.world || app.mode?.id !== 'sandbox') await app.generate(app.genParams);
    },
  };
  app.onModeChange = (id) => { void modes[id]?.(); };
  // wait for fonts so canvas lettering uses them
  try { await document.fonts.load('16px "IM Fell English"'); await document.fonts.load('16px "IM Fell English SC"'); } catch { /* ignore */ }
  const params = new URLSearchParams(location.search);
  app.genParams = { ...START_PARAMS, seed: params.get('seed') ?? START_PARAMS.seed };
  app.setMode(sandboxMode(app));
  await app.generate(app.genParams);
}

main();
