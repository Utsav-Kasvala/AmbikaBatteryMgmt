import { QueryClient } from '@tanstack/react-query';

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 30_000,       // 30s — cheap refresh window
      retry: 1,                 // one retry, then surface the error
      refetchOnWindowFocus: false,
    },
  },
});
