import { useContext, useEffect, useCallback } from 'react';

import { DataDocContext } from 'context/DataDoc';
import { scrollToCell } from 'lib/data-doc/data-doc-utils';

interface WebMCPToolResult {
    content: Array<{ type: string; text: string }>;
}

interface WebMCPTool {
    name: string;
    description: string;
    inputSchema: Record<string, unknown>;
    execute: (args: Record<string, unknown>) => Promise<WebMCPToolResult>;
}

interface ModelContext {
    registerTool(tool: WebMCPTool): void;
    unregisterTool(name: string): void;
}

function getModelContext(): ModelContext | null {
    return (navigator as any).modelContext ?? null;
}

const SUPPORTED_CELL_TYPES = ['query', 'python'] as const;

/**
 * Registers WebMCP tools that let a browser AI agent read from and
 * insert into Querybook cells. Tools are scoped to the component
 * lifecycle — they unregister on unmount.
 *
 * For DataDoc mode, pass isAdhoc=false. The hook reads DataDocContext
 * to find the last focused cell and call updateCell.
 *
 * For adhoc mode, pass isAdhoc=true and provide queryAccessor so the
 * hook can read/write the adhoc query without needing DataDocContext.
 */
export function useWebMCPTools(
    isAdhoc: boolean,
    queryAccessor?: { query: string; setQuery: (q: string) => void }
) {
    const dataDocContext = useContext(DataDocContext);

    const getLastFocusedCell = useCallback(() => {
        if (isAdhoc || !dataDocContext) {
            return null;
        }
        return dataDocContext.cellFocus.getLastFocusedCell();
    }, [isAdhoc, dataDocContext]);

    useEffect(() => {
        const mc = getModelContext();
        if (!mc) {
            return;
        }

        const toolNames: string[] = [];

        mc.registerTool({
            name: 'getCurrentQuery',
            description:
                'Returns the SQL or Python code from the currently focused Querybook cell',
            inputSchema: {
                type: 'object',
                properties: {},
            },
            execute: async () => {
                if (isAdhoc && queryAccessor) {
                    return {
                        content: [
                            {
                                type: 'text',
                                text: queryAccessor.query || 'Empty query',
                            },
                        ],
                    };
                }

                const cell = getLastFocusedCell();
                if (!cell) {
                    return {
                        content: [
                            {
                                type: 'text',
                                text: 'No cell is currently focused',
                            },
                        ],
                    };
                }

                const cellContext =
                    typeof cell.context === 'string' ? cell.context : '';
                return {
                    content: [
                        {
                            type: 'text',
                            text: cellContext || 'Empty cell',
                        },
                    ],
                };
            },
        });
        toolNames.push('getCurrentQuery');

        mc.registerTool({
            name: 'insertQuery',
            description:
                'Inserts SQL or Python code into the currently focused Querybook cell',
            inputSchema: {
                type: 'object',
                properties: {
                    code: {
                        type: 'string',
                        description: 'The code to insert',
                    },
                },
                required: ['code'],
            },
            execute: async (args) => {
                const code = String(args.code ?? '');

                if (isAdhoc && queryAccessor) {
                    const existing = queryAccessor.query;
                    queryAccessor.setQuery(
                        existing ? existing + '\n' + code : code
                    );
                    return {
                        content: [
                            {
                                type: 'text',
                                text: 'Inserted into adhoc query',
                            },
                        ],
                    };
                }

                if (!dataDocContext) {
                    return {
                        content: [
                            {
                                type: 'text',
                                text: 'DataDoc context not available',
                            },
                        ],
                    };
                }

                const { isEditable, cellFocus, updateCell } = dataDocContext;
                if (!isEditable) {
                    return {
                        content: [
                            { type: 'text', text: 'Cell is not editable' },
                        ],
                    };
                }

                const cell = cellFocus.getLastFocusedCell();
                if (!cell) {
                    return {
                        content: [
                            {
                                type: 'text',
                                text: 'No cell focused. Click on a cell first.',
                            },
                        ],
                    };
                }

                if (!SUPPORTED_CELL_TYPES.includes(cell.cell_type as any)) {
                    return {
                        content: [
                            {
                                type: 'text',
                                text: `Cell type "${cell.cell_type}" does not support insertion`,
                            },
                        ],
                    };
                }

                const newContext = cell.context
                    ? cell.context + '\n' + code
                    : code;

                scrollToCell(cell.id);
                await updateCell(cell.id, { context: newContext });

                return {
                    content: [
                        {
                            type: 'text',
                            text: `Inserted into cell ${cell.id}`,
                        },
                    ],
                };
            },
        });
        toolNames.push('insertQuery');

        console.log('[WebMCP] Registered tools:', toolNames.join(', '));

        return () => {
            for (const name of toolNames) {
                mc.unregisterTool(name);
            }
            console.log('[WebMCP] Unregistered tools:', toolNames.join(', '));
        };
    }, [isAdhoc, dataDocContext, queryAccessor, getLastFocusedCell]);
}
