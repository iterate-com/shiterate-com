interface CloudflareEnv {
    CURSOR_SESSIONS: DurableObjectNamespace<
      import("./worker/src/index").CursorSessions
    >;
    RPC_SERVICE: Service<import("./worker/src/index").SessionsRPC>;
    ASSETS: Fetcher;
  }