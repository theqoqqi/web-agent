export type JsonRpcId = number | string;

export interface JsonRpcErrorObject {
    code: number;
    message: string;
    data?: unknown;
}

export interface JsonRpcRequestMessage {
    jsonrpc: "2.0";
    id: JsonRpcId;
    method: string;
    params?: unknown;
}

export interface JsonRpcResponseMessage {
    jsonrpc: "2.0";
    id: JsonRpcId;
    result?: unknown;
    error?: JsonRpcErrorObject;
}

export interface JsonRpcNotificationMessage {
    jsonrpc: "2.0";
    method: string;
    params?: unknown;
}

export type JsonRpcMessage =
    | JsonRpcRequestMessage
    | JsonRpcResponseMessage
    | JsonRpcNotificationMessage;

export interface AcpClientCapabilities {
    fs: {
        readTextFile: false;
        writeTextFile: false;
    };
}

export interface AcpInitializeResult {
    protocolVersion: number;
    agentCapabilities?: {
        loadSession?: boolean;
    };
    agentInfo?: {
        name?: string;
        title?: string;
        version?: string;
    };
}

export interface AcpModelOption {
    modelId: string;
    name: string;
    description?: string;
}

export interface AcpModeOption {
    id: string;
    name: string;
    description?: string;
}

export interface AcpSessionModelsState {
    currentModelId?: string;
    availableModels?: AcpModelOption[];
}

export interface AcpSessionModesState {
    currentModeId?: string;
    availableModes?: AcpModeOption[];
}

export interface AcpNewSessionResult {
    sessionId: string;
    modes?: AcpSessionModesState;
    models?: AcpSessionModelsState;
}

export interface AcpLoadSessionResult {
    modes?: AcpSessionModesState;
    models?: AcpSessionModelsState;
}

export interface AcpPromptResult {
    stopReason?: string;
}

export interface AcpAvailableCommand {
    name: string;
    description: string;
    input?: {
        hint: string;
    };
}

export interface AcpToolLocation {
    path: string;
    line?: number;
}

export type AcpToolCallStatus = "pending" | "in_progress" | "completed" | "failed";

export interface AcpToolCall {
    toolCallId: string;
    title?: string;
    kind?: string;
    status?: AcpToolCallStatus;
    content?: unknown[];
    locations?: AcpToolLocation[];
    rawInput?: unknown;
    rawOutput?: unknown;
}

export interface AcpPermissionOption {
    optionId: string;
    name: string;
    kind?: string;
}

export interface AcpPermissionRequestParams {
    sessionId: string;
    toolCall: AcpToolCall;
    options: AcpPermissionOption[];
}

export interface AcpPermissionResponse {
    outcome:
        | {
              outcome: "selected";
              optionId: string;
          }
        | {
              outcome: "cancelled";
          };
}

export type AcpSessionUpdatePayload =
    | {
          sessionUpdate: "user_message_chunk";
          content: {
              type: "text";
              text: string;
          };
      }
    | {
          sessionUpdate: "agent_message_chunk";
          content: {
              type: "text";
              text: string;
          };
      }
    | {
          sessionUpdate: "agent_thought_chunk";
          content: {
              type: "text";
              text: string;
          };
      }
    | {
          sessionUpdate: "tool_call";
          toolCallId: string;
          title?: string;
          kind?: string;
          status?: AcpToolCallStatus;
          content?: unknown[];
          locations?: AcpToolLocation[];
          rawInput?: unknown;
          rawOutput?: unknown;
      }
    | {
          sessionUpdate: "tool_call_update";
          toolCallId: string;
          title?: string;
          kind?: string;
          status?: AcpToolCallStatus;
          content?: unknown[];
          locations?: AcpToolLocation[];
          rawInput?: unknown;
          rawOutput?: unknown;
      }
    | {
          sessionUpdate: "current_mode_update";
          currentModeId: string;
      }
    | {
          sessionUpdate: "available_commands_update";
          availableCommands: AcpAvailableCommand[];
      };

export interface AcpSessionUpdateParams {
    sessionId: string;
    update: AcpSessionUpdatePayload;
}
