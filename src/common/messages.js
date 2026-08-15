// The names of the two messages the panel and the worker exchange, and the
// shape of each.
//
//   getState      panel  -> worker   { type, tabId }
//                 worker -> panel    a RunState, or an idle one when there is none
//   stateChanged  worker -> panels   { type, tabId, state }

export const MessageType = {
  GET_STATE: "getState",
  STATE_CHANGED: "stateChanged",
};
