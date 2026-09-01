import { QueryClient, defaultShouldDehydrateQuery, isServer } from "@tanstack/react-query";

function makeQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: {
        // Cache data is considered fresh for 20 seconds before background refetching
        staleTime: 20 * 1000,
        // Inactive cache entries are garbage collected after 10 minutes
        gcTime: 10 * 60 * 1000,
        // Avoid automatic aggressive refetches on window focus for low-latency operational screens
        refetchOnWindowFocus: false,
        // Retry failed queries once before surfacing error
        retry: 1,
      },
      dehydrate: {
        shouldDehydrateQuery: (query) =>
          defaultShouldDehydrateQuery(query) || query.state.status === "pending",
      },
    },
  });
}

let browserQueryClient: QueryClient | undefined = undefined;

export function getQueryClient(): QueryClient {
  if (isServer) {
    // Server: always make a new query client for each SSR request
    return makeQueryClient();
  } else {
    // Browser: create a singleton instance and reuse across renders
    if (!browserQueryClient) browserQueryClient = makeQueryClient();
    return browserQueryClient;
  }
}
