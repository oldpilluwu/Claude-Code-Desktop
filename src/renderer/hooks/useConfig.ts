import { useCallback, useEffect, useState } from 'react';
import { api } from '@/lib/api';
import type { AppConfig } from '@shared/types';

export function useConfig() {
  const [config, setConfig] = useState<AppConfig | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let mounted = true;
    api.loadConfig().then((c) => {
      if (mounted) {
        setConfig(c);
        setLoading(false);
      }
    });
    return () => {
      mounted = false;
    };
  }, []);

  const save = useCallback(async (next: AppConfig) => {
    await api.saveConfig(next);
    setConfig(next);
  }, []);

  return { config, setConfig, save, loading };
}
