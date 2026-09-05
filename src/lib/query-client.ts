import { QueryClient, defaultShouldDehydrateQuery, isServer } from "@tanstack/react-query";

function makeQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: {
        // Cache data is considered fresh for 30 seconds before background refetching
        staleTime: 30 * 1000,
        // Inactive cache entries are garbage collected after 15 minutes
        gcTime: 15 * 60 * 1000,
        // Smart window focus revalidation
        refetchOnWindowFocus: false,
        // Automatically refetch stale queries when network reconnects
        refetchOnReconnect: true,
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
