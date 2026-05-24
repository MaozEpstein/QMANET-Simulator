/**
 * WebSocket client for live evolution streaming.
 *
 * Open `/ws/simulate`, send a SimulateRequest, then receive frame messages.
 * Callbacks decouple component lifecycle from network lifecycle; the caller
 * cancels by calling the returned `close()`.
 */

import type { SimulateRequest, SimulationFrameDTO } from "./rest";

export type EvolutionMessage =
  | { type: "frame"; frame: SimulationFrameDTO }
  | { type: "done"; n_atoms: number; duration_us: number; final_t_us: number }
  | { type: "error"; message: string };

export interface EvolutionHandle {
  close: () => void;
  /** True while the WS connection is still open. */
  readonly isOpen: boolean;
}

export function streamSimulation(
  request: SimulateRequest,
  callbacks: {
    onFrame?: (frame: SimulationFrameDTO) => void;
    onDone?: (info: { n_atoms: number; duration_us: number; final_t_us: number }) => void;
    onError?: (msg: string) => void;
    onOpen?: () => void;
  },
): EvolutionHandle {
  const proto = window.location.protocol === "https:" ? "wss:" : "ws:";
  const host = window.location.host;
  const url = `${proto}//${host}/ws/simulate`;

  const ws = new WebSocket(url);
  let open = true;
  const handle: EvolutionHandle = {
    close: () => {
      open = false;
      try {
        ws.close();
      } catch {
        // ignore
      }
    },
    get isOpen() {
      return open && ws.readyState === WebSocket.OPEN;
    },
  };

  ws.onopen = () => {
    ws.send(JSON.stringify(request));
    callbacks.onOpen?.();
  };

  ws.onmessage = (event) => {
    let msg: EvolutionMessage;
    try {
      msg = JSON.parse(event.data);
    } catch (e) {
      callbacks.onError?.(`bad JSON from server: ${(e as Error).message}`);
      return;
    }
    if (msg.type === "frame") callbacks.onFrame?.(msg.frame);
    else if (msg.type === "done") callbacks.onDone?.(msg);
    else if (msg.type === "error") callbacks.onError?.(msg.message);
  };

  ws.onerror = () => {
    callbacks.onError?.("websocket error");
  };

  ws.onclose = () => {
    open = false;
  };

  return handle;
}
