/**
 * Apollo Server plugin that attaches request/trace/failure IDs to GraphQL
 * errors. The plugin shape is structural so `@apollo/server` is not required.
 */

import { currentContext } from './context';

interface GraphQLErrorLike {
  extensions?: Record<string, unknown>;
}

interface ApolloResponseLike {
  errors?: GraphQLErrorLike[];
  extensions?: Record<string, unknown>;
}

interface ApolloRequestContextLike {
  response?: ApolloResponseLike;
}

export function tracekitApolloPlugin() {
  return {
    async requestDidStart() {
      return {
        async willSendResponse(requestContext: ApolloRequestContextLike) {
          const context = currentContext();
          const response = requestContext.response;
          if (!context || !response) return;
          const base: Record<string, unknown> = {
            requestId: context.requestId,
            traceId: context.traceId,
          };
          if (context.failureStage) {
            base.failureStage = context.failureStage;
            if (context.failureService) base.failureService = context.failureService;
          }
          for (const error of response.errors ?? []) {
            error.extensions = { ...base, ...(error.extensions ?? {}) };
          }
          if (response.errors?.length) {
            response.extensions = { ...base, ...(response.extensions ?? {}) };
          }
        },
      };
    },
  };
}
