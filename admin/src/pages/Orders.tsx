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
import { Search, ChevronUp, ChevronDown, ChevronsUpDown, Loader2, RefreshCw, Truck, ExternalLink } from 'lucide-react';
import { api, Order } from '../lib/api';
import { StatusBadge } from '../components/StatusBadge';
import { SlideOver } from '../components/SlideOver';
import clsx from 'clsx';

const columnHelper = createColumnHelper<Order>();

const ORDER_STATUSES = ['pending', 'paid', 'processing', 'shipped', 'delivered', 'refunded', 'canceled'] as const;

export function Orders() {
  const queryClient = useQueryClient();
  const [sorting, setSorting] = useState<SortingState>([{ id: 'created_at', desc: true }]);
  const [globalFilter, setGlobalFilter] = useState('');
  const [statusFilter, setStatusFilter] = useState<string>('');
  const [selectedOrder, setSelectedOrder] = useState<Order | null>(null);

  // Fetch orders
  const { data, isLoading, isFetching } = useQuery({
    queryKey: ['orders', statusFilter],
    queryFn: () => api.getOrders({ limit: 100, status: statusFilter || undefined }),
  });

  const orders = data?.items || [];

  // Update order mutation
  const updateMutation = useMutation({
    mutationFn: ({ id, data }: { id: string; data: Parameters<typeof api.updateOrder>[1] }) =>
      api.updateOrder(id, data),
    onSuccess: (updated) => {
      queryClient.invalidateQueries({ queryKey: ['orders'] });
      setSelectedOrder(updated);
    },
  });

  // Refund mutation
  const refundMutation = useMutation({
    mutationFn: (id: string) => api.refundOrder(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['orders'] });
    },
  });

  const columns = useMemo(() => [
    columnHelper.accessor('number', {
      header: 'Order',
      cell: (info) => (
        <span className="font-mono">{info.getValue() || info.row.original.id.slice(0, 8)}</span>
      ),
    }),
    columnHelper.accessor('customer_email', {
      header: 'Customer',
      cell: (info) => <span className="font-mono">{info.getValue() || '-'}</span>,
    }),
    columnHelper.accessor('status', {
      header: 'Status',
      cell: (info) => <StatusBadge status={info.getValue()} />,
    }),
    columnHelper.accessor((row) => row.amounts.total_cents, {
      id: 'total',
      header: () => <span className="block text-right">Total</span>,
      cell: (info) => (
        <span className="block text-right font-mono">
          ${(info.getValue() / 100).toFixed(2)}
        </span>
      ),
    }),
    columnHelper.accessor('created_at', {
      header: 'Date',
      cell: (info) => new Date(info.getValue()).toLocaleDateString(),
    }),
  ], []);

  const table = useReactTable({
    data: orders,
    columns,
    state: { sorting, globalFilter },
    onSortingChange: setSorting,
    onGlobalFilterChange: setGlobalFilter,
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
    getFilteredRowModel: getFilteredRowModel(),
  });

  const formatCurrency = (cents: number) => `$${(cents / 100).toFixed(2)}`;

  return (
    <div>
      {/* Header */}
      <div className="flex items-center justify-between mb-4 h-9">
        <h1 className="text-lg font-semibold" style={{ color: 'var(--text)' }}>Orders</h1>
        <button
          onClick={() => queryClient.invalidateQueries({ queryKey: ['orders'] })}
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
        {/* Filters */}
        <div
          className="flex items-center border-b"
          style={{ background: 'var(--bg-subtle)', borderColor: 'var(--border)' }}
        >
          {/* Search */}
          <div className="flex-1 flex items-center gap-2 px-4 py-3" style={{ color: 'var(--text-muted)' }}>
            <Search size={16} className="flex-shrink-0" />
            <input
              type="text"
              value={globalFilter}
              onChange={(e) => setGlobalFilter(e.target.value)}
              placeholder="Search orders..."
              className="bg-transparent border-0 text-sm w-full focus:outline-none font-mono"
              style={{ color: 'var(--text)' }}
            />
          </div>

          {/* Status filter */}
          <select
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value)}
            className="h-full px-4 py-3 text-sm bg-transparent border-0 border-l focus:outline-none cursor-pointer appearance-none"
            style={{
              borderColor: 'var(--border)',
              color: statusFilter ? 'var(--text)' : 'var(--text-muted)',
            }}
          >
            <option value="">All statuses</option>
            {ORDER_STATUSES.map((s) => (
              <option key={s} value={s}>{s}</option>
            ))}
          </select>
        </div>

        {/* Table */}
        {isLoading ? (
          <div className="py-12 flex items-center justify-center">
            <Loader2 size={20} className="animate-spin" style={{ color: 'var(--text-muted)' }} />
          </div>
        ) : orders.length === 0 ? (
          <div className="py-12 text-center text-sm" style={{ color: 'var(--text-muted)' }}>
            No orders yet
          </div>
        ) : (
          <table className="w-full font-mono text-[13px]">
            <thead style={{ background: 'var(--bg-subtle)' }}>
              {table.getHeaderGroups().map((headerGroup) => (
                <tr key={headerGroup.id}>
                  {headerGroup.headers.map((header) => (
                    <th
                      key={header.id}
                      onClick={header.column.getToggleSortingHandler()}
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
                  onClick={() => setSelectedOrder(row.original)}
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

      {/* Order Detail Slide-over */}
      <SlideOver
        open={!!selectedOrder}
        onClose={() => setSelectedOrder(null)}
        title={selectedOrder ? `Order ${selectedOrder.number || selectedOrder.id.slice(0, 8)}` : 'Order'}
        width="lg"
      >
        {selectedOrder && (
          <div className="space-y-6">
            {/* Status & Actions */}
            <div className="flex items-center justify-between">
              <StatusBadge status={selectedOrder.status} />
              {selectedOrder.status === 'paid' && selectedOrder.stripe?.payment_intent_id && selectedOrder.stripe && (
                <button
                  onClick={() => {
                    if (confirm('Are you sure you want to refund this order?')) {
                      refundMutation.mutate(selectedOrder.id);
                    }
                  }}
                  disabled={refundMutation.isPending}
                  className="text-sm text-red-500 hover:text-red-600 disabled:opacity-50"
                >
                  {refundMutation.isPending ? 'Refunding...' : 'Refund'}
                </button>
              )}
            </div>

            {/* Customer */}
            <div>
              <h4 className="text-xs font-medium uppercase tracking-wide mb-2" style={{ color: 'var(--text-secondary)' }}>
                Customer
              </h4>
              <p className="font-mono">{selectedOrder.customer_email}</p>
            </div>

            {/* Items */}
            <div>
              <h4 className="text-xs font-medium uppercase tracking-wide mb-2" style={{ color: 'var(--text-secondary)' }}>
                Items
              </h4>
              <div className="space-y-2">
                {selectedOrder.items.map((item, i) => (
                  <div
                    key={i}
                    className="flex items-center justify-between p-3 rounded"
                    style={{ background: 'var(--bg-subtle)', border: '1px solid var(--border-subtle)' }}
                  >
                    <div>
                      <p className="font-medium">{item.title}</p>
                      <p className="text-sm font-mono" style={{ color: 'var(--text-secondary)' }}>
                        {item.sku} × {item.qty}
                      </p>
                    </div>
                    <p className="font-mono">{formatCurrency(item.unit_price_cents * item.qty)}</p>
                  </div>
                ))}
              </div>
            </div>

            {/* Amounts */}
            <div>
              <h4 className="text-xs font-medium uppercase tracking-wide mb-2" style={{ color: 'var(--text-secondary)' }}>
                Summary
              </h4>
              <div className="space-y-1 font-mono text-sm">
                <div className="flex justify-between">
                  <span style={{ color: 'var(--text-secondary)' }}>Subtotal</span>
                  <span>{formatCurrency(selectedOrder.amounts.subtotal_cents)}</span>
                </div>
                <div className="flex justify-between">
                  <span style={{ color: 'var(--text-secondary)' }}>Tax</span>
                  <span>{formatCurrency(selectedOrder.amounts.tax_cents)}</span>
                </div>
                <div className="flex justify-between">
                  <span style={{ color: 'var(--text-secondary)' }}>Shipping</span>
                  <span>{formatCurrency(selectedOrder.amounts.shipping_cents)}</span>
                </div>
                <div className="flex justify-between pt-2 border-t font-semibold" style={{ borderColor: 'var(--border)' }}>
                  <span>Total</span>
                  <span>{formatCurrency(selectedOrder.amounts.total_cents)}</span>
                </div>
              </div>
            </div>

            {/* Shipping Address */}
            {selectedOrder.ship_to && (
              <div>
                <h4 className="text-xs font-medium uppercase tracking-wide mb-2" style={{ color: 'var(--text-secondary)' }}>
                  Shipping Address
                </h4>
                <div className="text-sm" style={{ color: 'var(--text-secondary)' }}>
                  {selectedOrder.ship_to.line1 && <p>{selectedOrder.ship_to.line1}</p>}
                  {selectedOrder.ship_to.line2 && <p>{selectedOrder.ship_to.line2}</p>}
                  <p>
                    {[selectedOrder.ship_to.city, selectedOrder.ship_to.state, selectedOrder.ship_to.postal_code]
                      .filter(Boolean)
                      .join(', ')}
                  </p>
                  {selectedOrder.ship_to.country && <p>{selectedOrder.ship_to.country}</p>}
                </div>
              </div>
            )}

            {/* Status Update */}
            <div>
              <h4 className="text-xs font-medium uppercase tracking-wide mb-2" style={{ color: 'var(--text-secondary)' }}>
                Update Status
              </h4>
              <select
                value={selectedOrder.status}
                onChange={(e) => {
                  updateMutation.mutate({
                    id: selectedOrder.id,
                    data: { status: e.target.value },
                  });
                }}
                disabled={updateMutation.isPending}
                className="w-full px-3 py-2 text-sm rounded focus:outline-none focus:ring-2"
                style={{
                  background: 'var(--bg-content)',
                  border: '1px solid var(--border)',
                  color: 'var(--text)',
                  '--tw-ring-color': 'var(--accent)',
                } as React.CSSProperties}
              >
                {ORDER_STATUSES.map((s) => (
                  <option key={s} value={s}>{s}</option>
                ))}
              </select>
            </div>

            {/* Tracking */}
            <div>
              <h4 className="text-xs font-medium uppercase tracking-wide mb-2 flex items-center gap-2" style={{ color: 'var(--text-secondary)' }}>
                <Truck size={14} />
                Tracking
              </h4>
              <div className="space-y-2">
                <input
                  type="text"
                  placeholder="Tracking number"
                  defaultValue={selectedOrder.tracking?.number || ''}
                  onBlur={(e) => {
                    if (e.target.value !== (selectedOrder.tracking?.number || '')) {
                      updateMutation.mutate({
                        id: selectedOrder.id,
                        data: { tracking_number: e.target.value },
                      });
                    }
                  }}
                  className="w-full px-3 py-2 text-sm font-mono rounded focus:outline-none focus:ring-2"
                  style={{
                    background: 'var(--bg-content)',
                    border: '1px solid var(--border)',
                    color: 'var(--text)',
                    '--tw-ring-color': 'var(--accent)',
                  } as React.CSSProperties}
                />
                <input
                  type="url"
                  placeholder="Tracking URL"
                  defaultValue={selectedOrder.tracking?.url || ''}
                  onBlur={(e) => {
                    if (e.target.value !== (selectedOrder.tracking?.url || '')) {
                      updateMutation.mutate({
                        id: selectedOrder.id,
                        data: { tracking_url: e.target.value },
                      });
                    }
                  }}
                  className="w-full px-3 py-2 text-sm font-mono rounded focus:outline-none focus:ring-2"
                  style={{
                    background: 'var(--bg-content)',
                    border: '1px solid var(--border)',
                    color: 'var(--text)',
                    '--tw-ring-color': 'var(--accent)',
                  } as React.CSSProperties}
                />
                {selectedOrder.tracking?.url && (
                  <a
                    href={selectedOrder.tracking.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-1 text-sm hover:underline"
                    style={{ color: 'var(--accent)' }}
                  >
                    <ExternalLink size={14} />
                    Track package
                  </a>
                )}
                {selectedOrder.tracking?.shipped_at && (
                  <p className="text-xs" style={{ color: 'var(--text-muted)' }}>
                    Shipped {new Date(selectedOrder.tracking.shipped_at).toLocaleString()}
                  </p>
                )}
              </div>
            </div>

            {/* Stripe Info */}
            {selectedOrder.stripe?.payment_intent_id && (
              <div>
                <h4 className="text-xs font-medium uppercase tracking-wide mb-2" style={{ color: 'var(--text-secondary)' }}>
                  Stripe
                </h4>
                <div className="text-sm font-mono" style={{ color: 'var(--text-muted)' }}>
                  <p>Payment: {selectedOrder.stripe.payment_intent_id}</p>
                  <p>Session: {selectedOrder.stripe.checkout_session_id}</p>
                </div>
              </div>
            )}

            {/* Timestamps */}
            <div className="pt-4 border-t text-xs" style={{ borderColor: 'var(--border)', color: 'var(--text-muted)' }}>
              <p>Created {new Date(selectedOrder.created_at).toLocaleString()}</p>
            </div>
          </div>
        )}
      </SlideOver>
    </div>
  );
}

