import { useState, useMemo } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  useReactTable,
  getCoreRowModel,
  getSortedRowModel,
  getFilteredRowModel,
  flexRender,
  createColumnHelper,
  SortingState,
} from '@tanstack/react-table';
import { Search, ChevronUp, ChevronDown, ChevronsUpDown, Loader2, RefreshCw, AlertTriangle, Package } from 'lucide-react';
import { api, InventoryItem } from '../lib/api';
import { SlideOver } from '../components/SlideOver';
import clsx from 'clsx';

const columnHelper = createColumnHelper<InventoryItem>();

const ADJUST_REASONS = ['restock', 'correction', 'damaged', 'return'] as const;

export function Inventory() {
  const queryClient = useQueryClient();
  const [sorting, setSorting] = useState<SortingState>([]);
  const [globalFilter, setGlobalFilter] = useState('');
  const [selectedItem, setSelectedItem] = useState<InventoryItem | null>(null);
  const [adjustDelta, setAdjustDelta] = useState('');
  const [adjustReason, setAdjustReason] = useState<string>('restock');

  // Fetch inventory
  const { data, isLoading, isFetching } = useQuery({
    queryKey: ['inventory'],
    queryFn: () => api.getInventory(),
  });

  const inventory = data?.items || [];

  // Adjust mutation
  const adjustMutation = useMutation({
    mutationFn: ({ sku, delta, reason }: { sku: string; delta: number; reason: string }) =>
      api.adjustInventory(sku, { delta, reason }),
    onSuccess: (updated) => {
      queryClient.invalidateQueries({ queryKey: ['inventory'] });
      // Update selected item with new values
      setSelectedItem(updated);
      setAdjustDelta('');
    },
  });

  const columns = useMemo(() => [
    columnHelper.accessor('sku', {
      header: 'SKU',
      cell: (info) => <span className="font-mono">{info.getValue()}</span>,
    }),
    columnHelper.accessor('product_title', {
      header: 'Product',
      cell: (info) => info.getValue() || '-',
    }),
    columnHelper.accessor('on_hand', {
      header: () => <span className="block text-right">On Hand</span>,
      cell: (info) => <span className="block text-right font-mono">{info.getValue()}</span>,
    }),
    columnHelper.accessor('reserved', {
      header: () => <span className="block text-right">Reserved</span>,
      cell: (info) => <span className="block text-right font-mono">{info.getValue()}</span>,
    }),
    columnHelper.accessor('available', {
      header: () => <span className="block text-right">Available</span>,
      cell: (info) => {
        const value = info.getValue();
        const isLow = value <= 5 && value > 0;
        const isOut = value <= 0;
        return (
          <span className={clsx(
            'block text-right font-mono',
            isOut && 'text-red-500',
            isLow && 'text-amber-500'
          )}>
            {isLow && <AlertTriangle size={12} className="inline mr-1" />}
            {value}
          </span>
        );
      },
    }),
  ], []);

  const table = useReactTable({
    data: inventory,
    columns,
    state: { sorting, globalFilter },
    onSortingChange: setSorting,
    onGlobalFilterChange: setGlobalFilter,
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
    getFilteredRowModel: getFilteredRowModel(),
  });

  const handleAdjust = (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedItem) return;
    const delta = parseInt(adjustDelta, 10);
    if (isNaN(delta)) return;
    adjustMutation.mutate({ sku: selectedItem.sku, delta, reason: adjustReason });
  };

  return (
    <div>
      {/* Header */}
      <div className="flex items-center justify-between mb-4 h-9">
        <h1 className="text-lg font-semibold" style={{ color: 'var(--text)' }}>Inventory</h1>
        <button
          onClick={() => queryClient.invalidateQueries({ queryKey: ['inventory'] })}
          disabled={isFetching}
          className="p-2 rounded hover:bg-[var(--bg-hover)] transition-colors disabled:opacity-50"
          style={{ color: 'var(--text-muted)' }}
        >
          <RefreshCw size={16} className={isFetching ? 'animate-spin' : ''} />
        </button>
      </div>

      {/* Table card */}
      <div
        className="rounded overflow-hidden"
        style={{ background: 'var(--bg-content)', border: '1px solid var(--border)' }}
      >
        {/* Search */}
        <div
          className="flex items-center border-b"
          style={{ background: 'var(--bg-subtle)', borderColor: 'var(--border)' }}
        >
          <div className="flex-1 flex items-center gap-2 px-4 py-3" style={{ color: 'var(--text-muted)' }}>
            <Search size={16} className="flex-shrink-0" />
            <input
              type="text"
              value={globalFilter}
              onChange={(e) => setGlobalFilter(e.target.value)}
              placeholder="Search SKUs..."
              className="bg-transparent border-0 text-sm w-full focus:outline-none font-mono"
              style={{ color: 'var(--text)' }}
            />
          </div>
        </div>

        {/* Table */}
        {isLoading ? (
          <div className="py-12 flex items-center justify-center">
            <Loader2 size={20} className="animate-spin" style={{ color: 'var(--text-muted)' }} />
          </div>
        ) : inventory.length === 0 ? (
          <div className="py-12 text-center text-sm" style={{ color: 'var(--text-muted)' }}>
            No inventory yet
          </div>
        ) : (
          <table className="w-full font-mono text-[13px]">
            <thead style={{ background: 'var(--bg-subtle)' }}>
              {table.getHeaderGroups().map((headerGroup) => (
                <tr key={headerGroup.id}>
                  {headerGroup.headers.map((header) => (
                    <th
                      key={header.id}
                      onClick={header.column.getCanSort() ? header.column.getToggleSortingHandler() : undefined}
                      className={clsx(
                        'px-4 py-2.5 text-left text-xs font-medium font-sans uppercase tracking-wide',
                        header.column.getCanSort() && 'cursor-pointer select-none hover:bg-[var(--bg-hover)]'
                      )}
                      style={{ color: 'var(--text-secondary)' }}
                    >
                      <div className="flex items-center gap-1">
                        {flexRender(header.column.columnDef.header, header.getContext())}
                        {header.column.getCanSort() && (
                          <span className="ml-1">
                            {header.column.getIsSorted() === 'asc' ? (
                              <ChevronUp size={14} />
                            ) : header.column.getIsSorted() === 'desc' ? (
                              <ChevronDown size={14} />
                            ) : (
                              <ChevronsUpDown size={14} className="opacity-30" />
                            )}
                          </span>
                        )}
                      </div>
                    </th>
                  ))}
                </tr>
              ))}
            </thead>
            <tbody>
              {table.getRowModel().rows.map((row) => (
                <tr
                  key={row.id}
                  onClick={() => {
                    setSelectedItem(row.original);
                    setAdjustDelta('');
                    setAdjustReason('restock');
                  }}
                  className="cursor-pointer transition-colors hover:bg-[var(--bg-hover)]"
                  style={{ borderBottom: '1px solid var(--border-subtle)' }}
                >
                  {row.getVisibleCells().map((cell) => (
                    <td key={cell.id} className="px-4 py-3">
                      {flexRender(cell.column.columnDef.cell, cell.getContext())}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {/* Inventory Detail Slide-over */}
      <SlideOver
        open={!!selectedItem}
        onClose={() => {
          setSelectedItem(null);
          setAdjustDelta('');
        }}
        title={selectedItem?.sku || 'Inventory'}
        width="md"
      >
        {selectedItem && (
          <div className="space-y-6">
            {/* Product info */}
            <div className="flex items-center gap-3">
              <div
                className="w-12 h-12 flex items-center justify-center rounded"
                style={{ background: 'var(--bg-subtle)', border: '1px solid var(--border)' }}
              >
                <Package size={20} style={{ color: 'var(--text-muted)' }} />
              </div>
              <div>
                <p className="font-mono font-medium">{selectedItem.sku}</p>
                <p className="text-sm" style={{ color: 'var(--text-secondary)' }}>
                  {selectedItem.product_title || 'Unknown product'}
                </p>
              </div>
            </div>

            {/* Stock levels */}
            <div>
              <h4 className="text-xs font-medium uppercase tracking-wide mb-3" style={{ color: 'var(--text-secondary)' }}>
                Stock Levels
              </h4>
              <div
                className="grid grid-cols-3 gap-4 p-4 rounded"
                style={{ background: 'var(--bg-subtle)', border: '1px solid var(--border-subtle)' }}
              >
                <div className="text-center">
                  <p className="text-2xl font-mono font-semibold">{selectedItem.on_hand}</p>
                  <p className="text-xs mt-1" style={{ color: 'var(--text-muted)' }}>On Hand</p>
                </div>
                <div className="text-center">
                  <p className="text-2xl font-mono font-semibold">{selectedItem.reserved}</p>
                  <p className="text-xs mt-1" style={{ color: 'var(--text-muted)' }}>Reserved</p>
                </div>
                <div className="text-center">
                  <p className={clsx(
                    'text-2xl font-mono font-semibold',
                    selectedItem.available <= 0 && 'text-red-500',
                    selectedItem.available > 0 && selectedItem.available <= 5 && 'text-amber-500'
                  )}>
                    {selectedItem.available}
                  </p>
                  <p className="text-xs mt-1" style={{ color: 'var(--text-muted)' }}>Available</p>
                </div>
              </div>
            </div>

            {/* Adjust form */}
            <div>
              <h4 className="text-xs font-medium uppercase tracking-wide mb-3" style={{ color: 'var(--text-secondary)' }}>
                Adjust Inventory
              </h4>
              <form onSubmit={handleAdjust} className="space-y-3">
                <div>
                  <label className="block text-sm font-medium mb-1">Quantity (+/-)</label>
                  <input
                    type="number"
                    value={adjustDelta}
                    onChange={(e) => setAdjustDelta(e.target.value)}
                    placeholder="e.g. 50 or -10"
                    required
                    className="w-full px-3 py-2 text-sm font-mono rounded focus:outline-none focus:ring-2"
                    style={{
                      background: 'var(--bg-content)',
                      border: '1px solid var(--border)',
                      color: 'var(--text)',
                      '--tw-ring-color': 'var(--accent)',
                    } as React.CSSProperties}
                  />
                </div>

                <div>
                  <label className="block text-sm font-medium mb-1">Reason</label>
                  <select
                    value={adjustReason}
                    onChange={(e) => setAdjustReason(e.target.value)}
                    className="w-full px-3 py-2 text-sm rounded focus:outline-none focus:ring-2"
                    style={{
                      background: 'var(--bg-content)',
                      border: '1px solid var(--border)',
                      color: 'var(--text)',
                      '--tw-ring-color': 'var(--accent)',
                    } as React.CSSProperties}
                  >
                    {ADJUST_REASONS.map((r) => (
                      <option key={r} value={r}>{r.charAt(0).toUpperCase() + r.slice(1)}</option>
                    ))}
                  </select>
                </div>

                <button
                  type="submit"
                  disabled={adjustMutation.isPending || !adjustDelta}
                  className="w-full px-4 py-2 text-sm font-semibold rounded transition-colors disabled:opacity-50"
                  style={{ background: 'var(--accent)', color: 'var(--text-inverse)' }}
                >
                  {adjustMutation.isPending ? 'Adjusting...' : 'Apply Adjustment'}
                </button>
              </form>
            </div>

            {/* Quick actions */}
            <div className="pt-4 border-t" style={{ borderColor: 'var(--border)' }}>
              <p className="text-xs mb-2" style={{ color: 'var(--text-muted)' }}>Quick adjustments</p>
              <div className="flex gap-2">
                {[10, 25, 50, 100].map((n) => (
                  <button
                    key={n}
                    type="button"
                    onClick={() => setAdjustDelta(String(n))}
                    className="px-3 py-1.5 text-sm font-mono rounded transition-colors hover:bg-[var(--bg-hover)]"
                    style={{ border: '1px solid var(--border)', color: 'var(--text-secondary)' }}
                  >
                    +{n}
                  </button>
                ))}
              </div>
            </div>
          </div>
        )}
      </SlideOver>
    </div>
  );
}
