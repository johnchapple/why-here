import '@fontsource/im-fell-english/400.css';
import '@fontsource/im-fell-english/400-italic.css';
import '@fontsource/im-fell-english-sc/400.css';
import './styles.css';
import { App } from './ui/app';
import { sandboxMode, START_PARAMS } from './ui/sandbox';
import { scenarioMode } from './ui/scenarios';
import { earthMode } from './earth/earthMode';
import { showOnboarding } from './ui/onboarding';

async function main() {
  const app = new App(document.getElementById('app')!);
  (window as unknown as { app: App }).app = app;
  let worldOwner = 'sandbox';
  const modes: Record<string, () => Promise<void> | void> = {
    sandbox: async () => {
      app.pause();
      app.editingAllowed = true;
      app.setMode(sandboxMode(app));
      if (worldOwner !== 'sandbox') { worldOwner = 'sandbox'; app.stopAt = 1600; await app.generate(app.genParams); }
    },
    scenario: () => {
      app.pause();
      worldOwner = 'scenario';
      app.setMode(scenarioMode(app));
    },
    earth: () => {
      app.pause();
      worldOwner = 'earth';
      app.setMode(earthMode(app));
    },
  };
  app.onModeChange = (id) => { void modes[id]?.(); };
  // wait for fonts so canvas lettering uses them
  try { await Promise.race([Promise.all([document.fonts.load('16px "IM Fell English"'), document.fonts.load('16px "IM Fell English SC"')]), new Promise((r) => setTimeout(r, 2500))]); } catch { /* ignore */ }
  const params = new URLSearchParams(location.search);
  app.genParams = { ...START_PARAMS, seed: params.get('seed') ?? START_PARAMS.seed };
  app.setMode(sandboxMode(app));
  await app.generate(app.genParams);
  const start = params.get('mode');
  if (start && modes[start]) await modes[start]();
  else if (!params.has('seed')) showOnboarding(app);
}

main();
