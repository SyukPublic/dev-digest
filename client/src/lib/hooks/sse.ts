/* hooks/sse.ts — Generic SSE hook; subscribe to one or more RunEvent streams by URL. */
"use client";

import React from "react";
import { notify } from "../toast";
import type { RunEvent } from "@devdigest/shared";

/** Subscribe to N SSE streams of RunEvent by URL. Content-addressed by the joined key. */
export function useSseEvents(urls: string[]): { events: RunEvent[]; running: boolean } {
  const [events, setEvents] = React.useState<RunEvent[]>([]);
  const [running, setRunning] = React.useState(false);
  const key = urls.join(",");

  React.useEffect(() => {
    if (urls.length === 0) return;
    setEvents([]);
    setRunning(true);
    const sources: EventSource[] = [];
    let open = urls.length;

    for (const url of urls) {
      const es = new EventSource(url);
      const onMsg = (ev: MessageEvent) => {
        try {
          const parsed = JSON.parse(ev.data) as RunEvent;
          setEvents((prev) => [...prev, parsed]);
          // Runtime failures arrive as SSE `error` events — surface via toast.
          if (parsed.kind === "error" && parsed.msg) notify.error(parsed.msg);
        } catch {
          /* ignore non-JSON keepalive frames */
        }
      };
      // The server tags events with kind as the SSE `event:` name AND emits them
      // as default messages too in some clients — listen broadly.
      es.onmessage = onMsg;
      for (const kind of ["info", "tool", "result", "error"]) {
        es.addEventListener(kind, onMsg as EventListener);
      }
      es.onerror = () => {
        es.close();
        open -= 1;
        if (open <= 0) setRunning(false);
      };
      sources.push(es);
    }

    return () => {
      for (const es of sources) es.close();
      setRunning(false);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  return { events, running };
}
