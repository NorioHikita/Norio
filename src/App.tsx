import { useState } from 'react';
import type { SessionConfig } from './types/realtime';
import { ApiKeySetup } from './components/ApiKeySetup';
import { InterpreterPanel } from './components/InterpreterPanel';

export default function App() {
  const [config, setConfig] = useState<SessionConfig | null>(null);

  if (!config) {
    return <ApiKeySetup onSubmit={setConfig} />;
  }

  return (
    <InterpreterPanel
      config={config}
      onReset={() => setConfig(null)}
    />
  );
}
