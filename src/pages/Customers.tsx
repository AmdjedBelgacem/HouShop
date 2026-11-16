import { useState, useEffect } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { invoke } from '@tauri-apps/api/core';
import { toast } from 'sonner';
import { useI18n } from '../i18n';
import type { CustomerWithStats, CustomerStats, CreateCustomer, UpdateCustomer } from '../lib/types';
import CustomSelect from '../components/CustomSelect';
import ConfirmDialog from '../components/ConfirmDialog';
import {
  Search, Plus, Pencil, Eye, ChevronLeft, ChevronRight,
  Users, Zap, UserPlus, FileBarChart, Filter, X,
} from 'lucide-react';
import { uiLocale } from '../i18n/locale';

const ITEMS_PER_PAGE = 10;

const AVATAR_COLORS = [
  'bg-accent-blue/10 text-accent-blue',
  'bg-accent-purple/10 text-accent-purple',
  'bg-accent-orange/10 text-accent-orange',
  'bg-accent-green/10 text-accent-green',
  'bg-accent-red/10 text-accent-red',
  'bg-navy/10 text-navy',
  'bg-border text-text-secondary',
];

interface CustomersProps {
  onAddCustomer: () => void;
  onEditCustomer?: (customer: CustomerWithStats) => void;
}

function getInitials(name: string): string {
  return name.split(' ').map(w => w[0]).join('').toUpperCase().slice(0, 2);
}

function avatarColor(id: number): string {
  return AVATAR_COLORS[id % AVATAR_COLORS.length];
}

function formatDate(iso: string | null): string {
  if (!iso) return '—';
  return new Date(iso).toLocaleDateString(uiLocale(), { month: 'short', day: 'numeric', year: 'numeric' });
}

export default function Customers({ onAddCustomer, onEditCustomer }: CustomersProps) {
  const queryClient = useQueryClient();
  const { t } = useI18n();
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('all');
  const [page, setPage] = useState(1);
  const [showForm, setShowForm] = useState(false);
  const [editing, setEditing] = useState<CustomerWithStats | null>(null);
  const [viewCustomer, setViewCustomer] = useState<CustomerWithStats | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<CustomerWithStats | null>(null);
  // Reference time for the "active today" KPI. Read from state (never Date.now()
  // during render) and refreshed every minute so the 24h window stays current.
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 60_000);
    return () => clearInterval(id);
  }, []);
  const [form, setForm] = useState({
    name: '', phone: '', address: '', notes: '', party_type: 'customer',
  });

  const { data: customers } = useQuery({
    queryKey: ['customers-with-stats'],
    queryFn: () => invoke<CustomerWithStats[]>('get_customers_with_stats'),
  });
  const { data: stats } = useQuery({
    queryKey: ['customer-stats'],
    queryFn: () => invoke<CustomerStats>('get_customer_stats'),
  });

  const createMutation = useMutation({
    mutationFn: (data: CreateCustomer) => invoke('create_customer', { data }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['customers-with-stats'] });
      queryClient.invalidateQueries({ queryKey: ['customer-stats'] });
      queryClient.invalidateQueries({ queryKey: ['dashboard-stats'] });
      setShowForm(false);
      toast.success(t('toast.customerCreated'));
    },
    onError: () => toast.error(t('toast.error')),
  });
  const updateMutation = useMutation({
    mutationFn: (data: UpdateCustomer) => invoke('update_customer', { data }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['customers-with-stats'] });
      queryClient.invalidateQueries({ queryKey: ['customer-stats'] });
      setEditing(null);
      setShowForm(false);
      toast.success(t('toast.customerUpdated'));
    },
    onError: () => toast.error(t('toast.error')),
  });
  const deleteMutation = useMutation({
    mutationFn: (id: number) => invoke('delete_customer', { id }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['customers-with-stats'] });
      queryClient.invalidateQueries({ queryKey: ['customer-stats'] });
      queryClient.invalidateQueries({ queryKey: ['dashboard-stats'] });
      setViewCustomer(null);
      setDeleteTarget(null);
      toast.success(t('toast.customerDeleted'));
    },
    onError: () => toast.error(t('toast.error')),
  });

  const openEdit = (c: CustomerWithStats) => {
    setEditing(c);
    setForm({
      name: c.name, phone: c.phone ?? '', address: c.address ?? '',
      notes: c.notes ?? '', party_type: c.party_type,
    });
    setShowForm(true);
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (editing) {
      updateMutation.mutate({
        id: editing.id, name: form.name,
        phone: form.phone || null, address: form.address || null,
        notes: form.notes || null, party_type: form.party_type,
      });
    } else {
      createMutation.mutate({
        name: form.name, phone: form.phone || null,
        address: form.address || null, notes: form.notes || null,
        party_type: form.party_type,
      });
    }
  };

  const filtered = (customers ?? []).filter(c => {
    if (search) {
      const q = search.toLowerCase();
      if (!c.name.toLowerCase().includes(q) &&
          !(c.phone?.toLowerCase().includes(q)) &&
          !c.party_type.toLowerCase().includes(q)) return false;
    }
    if (statusFilter === 'active') {
      if (c.order_count === 0) return false;
    } else if (statusFilter === 'inactive') {
      if (c.order_count > 0) return false;
    }
    return true;
  });
  const total = filtered.length;
  const totalPages = Math.max(1, Math.ceil(total / ITEMS_PER_PAGE));
  const paginated = filtered.slice((page - 1) * ITEMS_PER_PAGE, page * ITEMS_PER_PAGE);

  return (
    <div className="p-8">
      {/* Content sits in its own wrapper so the entrance transform never
          re-anchors the fixed modal overlays rendered below it. */}
      <div className="animate-fade-up">
        {/* Header */}
        <div className="flex flex-wrap items-end justify-between gap-4 mb-8">
          <div>
            <span className="eyebrow-accent mb-3 flex w-fit">{t('sidebar.groupSell')}</span>
            <h2 className="page-title">{t('customers.management')}</h2>
            <p className="page-subtitle">{t('customers.managementDesc')}</p>
          </div>
          <button type="button" onClick={onAddCustomer} className="btn-primary">
            <Plus size={16} strokeWidth={2} /> {t('customers.addNewFull')}
          </button>
        </div>

        {/* KPIs */}
        <div className="grid grid-cols-4 gap-5 mb-6">
          <KPICard icon={<Users size={16} className="text-accent-blue" />} label={t('customers.totalCustomers')}
            value={stats?.total_customers ?? 0} />
          <KPICard icon={<Zap size={16} className="text-accent-orange" />} label={t('customers.activeToday')}
            value={customers?.filter(c => {
              const d = new Date(c.updated_at);
              return d > new Date(now - 86400000);
            }).length ?? 0} />
          <KPICard icon={<UserPlus size={16} className="text-accent-green" />} label={t('customers.newThisMonth')}
            value={stats?.new_this_month ?? 0} />
          <KPICard icon={<FileBarChart size={16} className="text-accent-purple" />} label={t('customers.avgLifetimeValue')}
            value={`${(stats?.avg_lifetime_value ?? 0).toFixed(0)}\u200E DA`} />
        </div>

        {/* Filters */}
        <div className="flex flex-wrap items-center gap-3 mb-5">
          <div className="relative flex-1 min-w-[220px]">
            <Search size={15} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-text-muted pointer-events-none" />
            <input type="text" aria-label={t('common.search')} placeholder={t('customers.searchFull')} value={search}
              onChange={(e) => { setSearch(e.target.value); setPage(1); }}
              className="form-input pl-10" />
          </div>
          <CustomSelect
            value={statusFilter}
            onChange={(v) => { setStatusFilter(v); setPage(1); }}
            options={[
              { value: 'all', label: t('customers.allStatusesFull') },
              { value: 'active', label: t('customers.active') },
              { value: 'inactive', label: t('customers.inactive') },
            ]}
            icon={<Filter size={14} />}
            size="sm"
            className="w-[150px]"
          />
        </div>

        {/* Table */}
        <div className="card overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-[13px]">
              <thead>
                <tr className="border-b border-border-light bg-surface/60">
                  <th className="text-left py-3 px-5 text-text-muted font-medium text-[13px] whitespace-nowrap">{t('customers.customerHeader')}</th>
                  <th className="text-left py-3 px-4 text-text-muted font-medium text-[13px] whitespace-nowrap">{t('customers.phoneHeader')}</th>
                  <th className="text-right py-3 px-4 text-text-muted font-medium text-[13px] whitespace-nowrap">{t('customers.ordersHeader')}</th>
                  <th className="text-right py-3 px-4 text-text-muted font-medium text-[13px] whitespace-nowrap">{t('customers.totalSpentHeader')}</th>
                  <th className="text-left py-3 px-4 text-text-muted font-medium text-[13px] whitespace-nowrap">{t('customers.lastOrderHeader')}</th>
                  <th className="text-center py-3 px-4 text-text-muted font-medium text-[13px] whitespace-nowrap">{t('customers.statusHeader')}</th>
                  <th className="text-center py-3 px-5 text-text-muted font-medium text-[13px] whitespace-nowrap w-20">{t('customers.actionsHeader')}</th>
                </tr>
              </thead>
              <tbody>
                {paginated.length === 0 ? (
                  <tr><td colSpan={7} className="py-16">
                    <div className="flex flex-col items-center text-center">
                      <div className="w-12 h-12 rounded-full bg-surface flex items-center justify-center text-text-muted mb-3">
                        <Users size={22} />
                      </div>
                      <p className="text-[14px] font-medium text-text-primary">{t('customers.noCustomersFound')}</p>
                      <button type="button" onClick={onAddCustomer} className="btn-secondary mt-4 py-2">
                        <Plus size={15} /> {t('customers.addNewFull')}
                      </button>
                    </div>
                  </td></tr>
                ) : (
                  paginated.map((c) => {
                    const initials = getInitials(c.name);
                    const isActive = c.order_count > 0;
                    return (
                      <tr key={c.id} className="border-b border-border-light hover:bg-surface transition-colors">
                        <td className="py-3.5 px-5">
                          <div className="flex items-center gap-3">
                            <div className={`w-9 h-9 rounded-full flex items-center justify-center text-[13px] font-semibold flex-shrink-0 ${avatarColor(c.id)}`}>
                              {initials}
                            </div>
                            <div>
                              <p className="font-medium text-text-primary">{c.name}</p>
                              <p className="text-[13px] text-text-muted tabular-nums">ID: #HP-{1000 + c.id}</p>
                            </div>
                          </div>
                        </td>
                        <td className="py-3.5 px-4 text-text-secondary text-[13px] tabular-nums">{c.phone ?? '—'}</td>
                        <td className="py-3.5 px-4 text-right text-text-primary font-medium tabular-nums whitespace-nowrap">{t('customers.ordersCount', { count: c.order_count })}</td>
                        <td className="py-3.5 px-4 text-right font-semibold text-text-primary tabular-nums whitespace-nowrap">
                          {c.total_spent.toLocaleString('en-US', { minimumFractionDigits: 2 })}&lrm; DA
                        </td>
                        <td className="py-3.5 px-4 text-text-secondary text-[13px] whitespace-nowrap">{formatDate(c.last_order_date)}</td>
                        <td className="py-3.5 px-4 text-center">
                          <span className={`badge ${isActive ? 'bg-accent-green/10 text-accent-green' : 'bg-surface text-text-muted'}`}>
                            <span className="w-1.5 h-1.5 rounded-full bg-current" aria-hidden="true" />
                            {isActive ? t('customers.active') : t('customers.inactive')}
                          </span>
                        </td>
                        <td className="py-3.5 px-5">
                          <div className="flex items-center justify-center gap-1">
                            <button type="button" onClick={() => onEditCustomer ? onEditCustomer(c) : openEdit(c)}
                              aria-label={t('common.edit')} title={t('common.edit')}
                              className="p-1.5 rounded-lg text-text-secondary hover:bg-accent-blue/10 hover:text-accent-blue transition-colors">
                              <Pencil size={15} />
                            </button>
                            <button type="button" onClick={() => setViewCustomer(c)}
                              aria-label={t('customers.view')} title={t('customers.view')}
                              className="p-1.5 rounded-lg text-text-secondary hover:bg-surface hover:text-text-primary transition-colors">
                              <Eye size={15} />
                            </button>
                          </div>
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>
          {/* Pagination */}
          {total > 0 && (
            <div className="flex items-center justify-between px-5 py-3 border-t border-border-light">
              <p className="text-[13px] text-text-muted">
                {t('customers.showing', { start: (page - 1) * ITEMS_PER_PAGE + 1, end: Math.min(page * ITEMS_PER_PAGE, total), total })}
              </p>
              <div className="flex items-center gap-1">
                <button type="button" aria-label={t('common.previous')} disabled={page <= 1} onClick={() => setPage(p => p - 1)}
                  className="p-1.5 rounded-lg text-text-secondary hover:bg-surface transition-colors disabled:opacity-40 disabled:pointer-events-none">
                  <ChevronLeft size={16} />
                </button>
                {Array.from({ length: Math.min(totalPages, 5) }, (_, i) => {
                  const pg = i + 1;
                  return (
                    <button type="button" key={pg} onClick={() => setPage(pg)}
                      aria-current={page === pg ? 'page' : undefined}
                      className={`min-w-[28px] h-7 px-2 rounded-lg text-[13px] font-medium tabular-nums transition-colors ${
                        page === pg ? 'bg-navy text-white' : 'text-text-secondary hover:bg-surface'
                      }`}>{pg}</button>
                  );
                })}
                {totalPages > 5 && <span className="px-1 text-text-muted text-[13px]">...</span>}
                {totalPages > 5 && (
                  <button type="button" onClick={() => setPage(totalPages)}
                    className="min-w-[28px] h-7 px-2 rounded-lg text-[13px] font-medium tabular-nums text-text-secondary hover:bg-surface transition-colors">{totalPages}</button>
                )}
                <button type="button" aria-label={t('common.next')} disabled={page >= totalPages} onClick={() => setPage(p => p + 1)}
                  className="p-1.5 rounded-lg text-text-secondary hover:bg-surface transition-colors disabled:opacity-40 disabled:pointer-events-none">
                  <ChevronRight size={16} />
                </button>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Add / edit form */}
      {showForm && (
        <ModalOverlay onClose={() => setShowForm(false)}>
          <form onSubmit={handleSubmit}
            className="bg-card rounded-2xl w-full max-w-lg flex flex-col shadow-raised border border-border">
            <div className="flex items-center justify-between px-6 py-4 border-b border-border-light">
              <h3 className="text-[16px] font-semibold text-text-primary">{editing ? t('customers.editCustomer') : t('customers.addCustomerModal')}</h3>
              <button type="button" onClick={() => setShowForm(false)} aria-label={t('common.close')}
                className="p-1.5 rounded-lg text-text-muted hover:bg-surface hover:text-text-primary transition-colors">
                <X size={16} />
              </button>
            </div>
            <div className="p-6 space-y-4">
              <FormField label={t('customers.fullName')} required>
                <input type="text" required value={form.name} onChange={(e) => setForm(f => ({ ...f, name: e.target.value }))}
                  className="form-input" placeholder={t('customers.customerNamePh')} />
              </FormField>
              <div className="grid grid-cols-2 gap-4">
                <FormField label={t('common.phone')}>
                  <input type="text" value={form.phone} onChange={(e) => setForm(f => ({ ...f, phone: e.target.value }))}
                    className="form-input" placeholder={t('customers.phonePh')} />
                </FormField>
                <FormField label={t('customers.type')}>
                  <CustomSelect
                    value={form.party_type}
                    onChange={(v) => setForm(f => ({ ...f, party_type: v }))}
                    options={[
                      { value: 'customer', label: t('customers.customerType') },
                      { value: 'supplier', label: t('customers.supplier') },
                      { value: 'both', label: t('customers.both') },
                    ]}
                    placeholder={t('customers.selectType')}
                  />
                </FormField>
              </div>
              <FormField label={t('common.address')}>
                <input type="text" value={form.address} onChange={(e) => setForm(f => ({ ...f, address: e.target.value }))}
                  className="form-input" placeholder={t('customers.streetAddress')} />
              </FormField>
              <FormField label={t('common.notes')}>
                <textarea value={form.notes} onChange={(e) => setForm(f => ({ ...f, notes: e.target.value }))}
                  className="form-input min-h-[72px] resize-y" placeholder={t('customers.additionalNotes')} />
              </FormField>
            </div>
            <div className="flex items-center justify-end gap-3 px-6 py-4 border-t border-border-light">
              <button type="button" onClick={() => setShowForm(false)} className="btn-secondary">{t('common.cancel')}</button>
              <button type="submit" disabled={createMutation.isPending || updateMutation.isPending} className="btn-primary">
                {editing ? t('addProduct.saveChanges') : t('customers.addCustomer')}
              </button>
            </div>
          </form>
        </ModalOverlay>
      )}

      {/* Customer details */}
      {viewCustomer && (
        <ModalOverlay onClose={() => setViewCustomer(null)}>
          <div className="bg-card rounded-2xl w-full max-w-md shadow-raised border border-border overflow-hidden">
            <div className="flex items-center justify-between px-6 py-4 border-b border-border-light">
              <h3 className="text-[16px] font-semibold text-text-primary">{t('customers.customerDetails')}</h3>
              <button type="button" onClick={() => setViewCustomer(null)} aria-label={t('common.close')}
                className="p-1.5 rounded-lg text-text-muted hover:bg-surface hover:text-text-primary transition-colors">
                <X size={16} />
              </button>
            </div>
            <div className="p-6">
              <div className="flex items-center gap-4 mb-6">
                <div className={`w-14 h-14 rounded-full flex items-center justify-center text-[16px] font-semibold ${avatarColor(viewCustomer.id)}`}>
                  {getInitials(viewCustomer.name)}
                </div>
                <div>
                  <p className="text-[16px] font-semibold text-text-primary">{viewCustomer.name}</p>
                  <p className="text-[13px] text-text-muted tabular-nums">ID: #HP-{1000 + viewCustomer.id}</p>
                </div>
              </div>
              <div className="space-y-1 text-[13px]">
                <DetailRow label={t('common.phone')} value={viewCustomer.phone ?? '—'} />
                <DetailRow label={t('common.address')} value={viewCustomer.address ?? '—'} />
                <DetailRow label={t('customers.typeLabel')} value={viewCustomer.party_type.charAt(0).toUpperCase() + viewCustomer.party_type.slice(1)} />
                <DetailRow label={t('customers.ordersLabel')} value={`${viewCustomer.order_count} orders`} />
                <DetailRow label={t('customers.totalSpentLabel')} value={`${viewCustomer.total_spent.toFixed(2)}\u200E DA`} />
                <DetailRow label={t('customers.lastOrderLabel')} value={formatDate(viewCustomer.last_order_date)} />
                <DetailRow label={t('customers.notesLabel')} value={viewCustomer.notes ?? '—'} />
                <DetailRow label={t('customers.joinedLabel')} value={formatDate(viewCustomer.created_at)} />
              </div>
              <div className="flex gap-3 mt-6">
                <button type="button" onClick={() => { setViewCustomer(null); openEdit(viewCustomer); }}
                  className="btn-primary flex-1">
                  {t('customers.editCustomerBtn')}
                </button>
                <button type="button" onClick={() => { setDeleteTarget(viewCustomer); }}
                  className="btn-secondary text-accent-red border-accent-red/40 hover:bg-accent-red/10">
                  {t('customers.deleteBtn')}
                </button>
              </div>
            </div>
          </div>
        </ModalOverlay>
      )}

      <ConfirmDialog
        open={!!deleteTarget}
        variant="danger"
        title={t('common.delete')}
        description={t('customers.deleteConfirm', { name: deleteTarget?.name ?? '' })}
        confirmLabel={t('common.delete')}
        loading={deleteMutation.isPending}
        onConfirm={() => deleteTarget && deleteMutation.mutate(deleteTarget.id)}
        onCancel={() => setDeleteTarget(null)}
      />
    </div>
  );
}

function KPICard({ icon, label, value }: {
  icon: React.ReactNode; label: string; value: number | string;
}) {
  return (
    <div className="card p-5">
      <div className="flex items-center gap-2 mb-2">
        {icon}
        <p className="text-[13px] font-medium text-text-secondary">{label}</p>
      </div>
      <p className="text-[24px] font-semibold tracking-[-0.02em] text-text-primary tabular-nums leading-tight">
        {value}
      </p>
    </div>
  );
}
function FormField({ label, required, children }: { label: string; required?: boolean; children: React.ReactNode }) {
  return (
    <div>
      <label className="block text-[13px] font-medium text-text-secondary mb-1.5">
        {label}{required && <span className="text-accent-red ml-0.5">*</span>}
      </label>
      {children}
    </div>
  );
}
function DetailRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between gap-4 py-2.5 border-b border-border-light last:border-0">
      <span className="text-text-muted">{label}</span>
      <span className="font-medium text-text-primary text-right">{value}</span>
    </div>
  );
}
function ModalOverlay({ children, onClose }: { children: React.ReactNode; onClose: () => void }) {
  return (
    <div className="fixed inset-0 bg-black/30 backdrop-blur-sm flex items-center justify-center z-50 p-4" onClick={onClose}>
      <div onClick={(e) => e.stopPropagation()} className="animate-fade-up w-full flex justify-center">{children}</div>
    </div>
  );
}
