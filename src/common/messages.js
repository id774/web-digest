// The names of the three messages the panel and the worker exchange, and the
// shape of each.
//
//   getState      panel  -> worker   { type, tabId }
//                 worker -> panel    a RunState, or an idle one when there is none
//   run           panel  -> worker   { type, tabId }
//                 worker -> panel    { accepted: true }
//   stateChanged  worker -> panels   { type, tabId, state }
//
// The result of a run is never a response to `run`: a run outlives the message
// and the worker may be terminated during it, so the panel learns what
// happened by reading the state.

export const MessageType = {
  GET_STATE: "getState",
  RUN: "run",
  STATE_CHANGED: "stateChanged",
};
