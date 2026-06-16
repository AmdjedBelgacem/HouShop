import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { invoke } from '@tauri-apps/api/core';
import { useI18n } from '../i18n';
import type { CustomerWithStats, CustomerStats, CreateCustomer, UpdateCustomer } from '../lib/types';
import CustomSelect from '../components/CustomSelect';
import {
  Search, Plus, Pencil, Eye, ChevronLeft, ChevronRight,
  Users, Zap, UserPlus, FileBarChart, Filter, X,
} from 'lucide-react';
const ITEMS_PER_PAGE = 10;
const AVATAR_COLORS = ['#3B82F6', '#8B5CF6', '#F59E0B', '#6B7280', '#06B6D4', '#EC4899', '#10B981', '#F97316'];
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
  return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
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
    },
  });
  const updateMutation = useMutation({
    mutationFn: (data: UpdateCustomer) => invoke('update_customer', { data }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['customers-with-stats'] });
      queryClient.invalidateQueries({ queryKey: ['customer-stats'] });
      setEditing(null);
      setShowForm(false);
    },
  });
  const deleteMutation = useMutation({
    mutationFn: (id: number) => invoke('delete_customer', { id }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['customers-with-stats'] });
      queryClient.invalidateQueries({ queryKey: ['customer-stats'] });
      queryClient.invalidateQueries({ queryKey: ['dashboard-stats'] });
    },
  });
  const openCreate = () => {
    setEditing(null);
    setForm({ name: '', phone: '', address: '', notes: '', party_type: 'customer' });
    setShowForm(true);
  };
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
      {}
      <div className="mb-7">
        <h2 className="text-[26px] font-bold text-text-primary leading-tight">{t('customers.management')}</h2>
        <p className="text-[14px] text-text-secondary mt-1.5">
          {t('customers.managementDesc')}
        </p>
      </div>
      {}
      <div className="grid grid-cols-4 gap-5 mb-6">
        <KPICard icon={<Users size={18} className="text-accent-blue" />} label={t('customers.totalCustomers')}
          value={stats?.total_customers ?? 0} badge="+12%" badgeColor="green" />
        <KPICard icon={<Zap size={18} className="text-amber-500" />} label={t('customers.activeToday')}
          value={customers?.filter(c => {
            const d = new Date(c.updated_at);
            return d > new Date(Date.now() - 86400000);
          }).length ?? 0} badge={t('customers.stable')} badgeColor="gray" />
        <KPICard icon={<UserPlus size={18} className="text-emerald-500" />} label={t('customers.newThisMonth')}
          value={stats?.new_this_month ?? 0} badge="+4.5%" badgeColor="green" />
        <KPICard icon={<FileBarChart size={18} className="text-purple-500" />} label={t('customers.avgLifetimeValue')}
          value={`${(stats?.avg_lifetime_value ?? 0).toFixed(0)} DA`} badge={t('customers.high')} badgeColor="green" isPrefix />
      </div>
      {}
      <div className="card px-4 py-3 mb-5 flex items-center gap-3">
        <div className="relative flex-1">
          <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-text-muted" />
          <input type="text" placeholder={t('customers.searchFull')} value={search}
            onChange={(e) => { setSearch(e.target.value); setPage(1); }}
            className="w-full pl-9 pr-4 py-2 rounded-lg border border-border text-[13px] focus:outline-none focus:ring-2 focus:ring-navy/15 focus:border-navy/30 placeholder:text-text-muted bg-surface" />
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
        <button onClick={onAddCustomer}
          className="flex items-center gap-2 px-5 py-2.5 bg-navy text-white rounded-lg text-[13px] font-medium hover:bg-navy-light transition-colors">
          <Plus size={16} strokeWidth={2} /> {t('customers.addNewFull')}
        </button>
      </div>
      {}
      <div className="card overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-[13px]">
            <thead>
              <tr className="border-b border-border bg-sidebar/50">
                <th className="text-left py-3 px-5 text-text-muted font-semibold text-[11px] uppercase tracking-wider">{t('customers.customerHeader')}</th>
                <th className="text-left py-3 px-4 text-text-muted font-semibold text-[11px] uppercase tracking-wider">{t('customers.phoneHeader')}</th>
                <th className="text-right py-3 px-4 text-text-muted font-semibold text-[11px] uppercase tracking-wider">{t('customers.ordersHeader')}</th>
                <th className="text-right py-3 px-4 text-text-muted font-semibold text-[11px] uppercase tracking-wider">{t('customers.totalSpentHeader')}</th>
                <th className="text-left py-3 px-4 text-text-muted font-semibold text-[11px] uppercase tracking-wider">{t('customers.lastOrderHeader')}</th>
                <th className="text-center py-3 px-4 text-text-muted font-semibold text-[11px] uppercase tracking-wider">{t('customers.statusHeader')}</th>
                <th className="text-center py-3 px-5 text-text-muted font-semibold text-[11px] uppercase tracking-wider w-20">{t('customers.actionsHeader')}</th>
              </tr>
            </thead>
            <tbody>
              {paginated.length === 0 ? (
                <tr><td colSpan={7} className="py-16 text-center text-text-muted">
                  <Users size={28} className="mx-auto mb-2 opacity-30" />
                  {t('customers.noCustomersFound')}
                </td></tr>
              ) : (
                paginated.map((c) => {
                  const initials = getInitials(c.name);
                  const isActive = c.order_count > 0;
                  return (
                    <tr key={c.id} className="border-b border-border-light hover:bg-sidebar/30 transition-colors">
                      <td className="py-3 px-5">
                        <div className="flex items-center gap-3">
                          <div className="w-9 h-9 rounded-full flex items-center justify-center text-white text-[11px] font-bold flex-shrink-0"
                            style={{ background: avatarColor(c.id) }}>
                            {initials}
                          </div>
                          <div>
                            <p className="font-semibold text-text-primary text-[13px]">{c.name}</p>
                            <p className="text-[11px] text-text-muted">ID: #HP-{1000 + c.id}</p>
                          </div>
                        </div>
                      </td>
                      <td className="py-3 px-4 text-text-secondary text-[12.5px]">{c.phone ?? '—'}</td>
                      <td className="py-3 px-4 text-right text-text-primary font-medium">{t('customers.ordersCount', { count: c.order_count })}</td>
                      <td className="py-3 px-4 text-right font-semibold text-text-primary">
                        {c.total_spent.toLocaleString('en-US', { minimumFractionDigits: 2 })} DA
                      </td>
                      <td className="py-3 px-4 text-text-secondary text-[12.5px]">{formatDate(c.last_order_date)}</td>
                      <td className="py-3 px-4 text-center">
                        <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-[11px] font-semibold ${
                          isActive
                            ? 'bg-emerald-50 text-emerald-700 border border-emerald-200'
                            : 'bg-surface text-text-muted border border-border'
                        }`}>
                          {isActive ? t('customers.active') : t('customers.inactive')}
                        </span>
                      </td>
                      <td className="py-3 px-5">
                        <div className="flex items-center justify-center gap-1">
                          <button onClick={() => onEditCustomer ? onEditCustomer(c) : openEdit(c)}
                            className="p-1.5 rounded-md text-text-secondary hover:bg-blue-50 hover:text-accent-blue transition-colors" title="Edit">
                            <Pencil size={15} />
                          </button>
                          <button onClick={() => setViewCustomer(c)}
                            className="p-1.5 rounded-md text-text-secondary hover:bg-surface hover:text-text-primary transition-colors" title="View">
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
        {}
        {total > 0 && (
          <div className="flex items-center justify-between px-5 py-3.5 border-t border-border bg-sidebar/30">
            <p className="text-[12px] text-text-muted">
              {t('customers.showing', { start: (page - 1) * ITEMS_PER_PAGE + 1, end: Math.min(page * ITEMS_PER_PAGE, total), total })}
            </p>
            <div className="flex items-center gap-1">
              <button disabled={page <= 1} onClick={() => setPage(p => p - 1)}
                className="p-1.5 rounded-md text-text-muted hover:bg-card disabled:opacity-30 transition-colors">
                <ChevronLeft size={16} />
              </button>
              {Array.from({ length: Math.min(totalPages, 5) }, (_, i) => {
                const pg = i + 1;
                return (
                  <button key={pg} onClick={() => setPage(pg)}
                    className={`w-7 h-7 rounded-md text-[12px] font-medium transition-colors ${
                      page === pg ? 'bg-navy text-white' : 'text-text-secondary hover:bg-card'
                    }`}>{pg}</button>
                );
              })}
              {totalPages > 5 && <span className="px-1 text-text-muted text-[12px]">...</span>}
              {totalPages > 5 && (
                <button onClick={() => setPage(totalPages)}
                  className={`w-7 h-7 rounded-md text-[12px] font-medium text-text-secondary hover:bg-card transition-colors`}>{totalPages}</button>
              )}
              <button disabled={page >= totalPages} onClick={() => setPage(p => p + 1)}
                className="p-1.5 rounded-md text-text-muted hover:bg-card disabled:opacity-30 transition-colors">
                <ChevronRight size={16} />
              </button>
            </div>
          </div>
        )}
      </div>
      {}
      {showForm && (
        <ModalOverlay onClose={() => setShowForm(false)}>
          <div className="bg-card rounded-2xl w-full max-w-lg shadow-xl overflow-hidden">
            <div className="flex items-center justify-between px-6 py-4 border-b border-border">
              <h3 className="text-[16px] font-bold text-text-primary">{editing ? t('customers.editCustomer') : t('customers.addCustomerModal')}</h3>
              <button onClick={() => setShowForm(false)} className="p-1 rounded-lg hover:bg-surface transition-colors"><X size={18} /></button>
            </div>
            <form onSubmit={handleSubmit} className="p-6 space-y-4">
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
                  className="form-input min-h-[60px] resize-y" placeholder={t('customers.additionalNotes')} />
              </FormField>
              <div className="flex gap-3 pt-3">
                <button type="button" onClick={() => setShowForm(false)}
                  className="flex-1 py-2.5 rounded-lg border border-border text-[13px] font-medium text-text-secondary hover:bg-surface transition-colors">{t('common.cancel')}</button>
                <button type="submit" disabled={createMutation.isPending || updateMutation.isPending}
                  className="flex-1 py-2.5 rounded-lg bg-navy text-white text-[13px] font-medium hover:bg-navy-light disabled:opacity-50 transition-colors">
                  {editing ? t('addProduct.saveChanges') : t('customers.addCustomer')}
                </button>
              </div>
            </form>
          </div>
        </ModalOverlay>
      )}
      {}
      {viewCustomer && (
        <ModalOverlay onClose={() => setViewCustomer(null)}>
          <div className="bg-card rounded-2xl w-full max-w-md shadow-xl overflow-hidden">
            <div className="flex items-center justify-between px-6 py-4 border-b border-border">
              <h3 className="text-[16px] font-bold text-text-primary">{t('customers.customerDetails')}</h3>
              <button onClick={() => setViewCustomer(null)} className="p-1 rounded-lg hover:bg-surface transition-colors"><X size={18} /></button>
            </div>
            <div className="p-6">
              <div className="flex items-center gap-4 mb-6">
                <div className="w-14 h-14 rounded-full flex items-center justify-center text-white text-[16px] font-bold"
                  style={{ background: avatarColor(viewCustomer.id) }}>
                  {getInitials(viewCustomer.name)}
                </div>
                <div>
                  <p className="text-[16px] font-bold text-text-primary">{viewCustomer.name}</p>
                  <p className="text-[12px] text-text-muted">ID: #HP-{1000 + viewCustomer.id}</p>
                </div>
              </div>
              <div className="space-y-3 text-[13px]">
                <DetailRow label={t('common.phone')} value={viewCustomer.phone ?? '—'} />
                <DetailRow label={t('common.address')} value={viewCustomer.address ?? '—'} />
                <DetailRow label={t('customers.typeLabel')} value={viewCustomer.party_type.charAt(0).toUpperCase() + viewCustomer.party_type.slice(1)} />
                <DetailRow label={t('customers.ordersLabel')} value={`${viewCustomer.order_count} orders`} />
                <DetailRow label={t('customers.totalSpentLabel')} value={`${viewCustomer.total_spent.toFixed(2)} DA`} />
                <DetailRow label={t('customers.lastOrderLabel')} value={formatDate(viewCustomer.last_order_date)} />
                <DetailRow label={t('customers.notesLabel')} value={viewCustomer.notes ?? '—'} />
                <DetailRow label={t('customers.joinedLabel')} value={formatDate(viewCustomer.created_at)} />
              </div>
              <div className="flex gap-3 mt-6">
                <button onClick={() => { setViewCustomer(null); openEdit(viewCustomer); }}
                  className="flex-1 py-2.5 rounded-lg bg-navy text-white text-[13px] font-medium hover:bg-navy-light transition-colors">
                  {t('customers.editCustomerBtn')}
                </button>
                <button onClick={() => {
                  if (confirm(t('customers.confirmDelete', { name: viewCustomer.name }))) {
                    deleteMutation.mutate(viewCustomer.id);
                    setViewCustomer(null);
                  }
                }}
                  className="py-2.5 px-4 rounded-lg border border-accent-red text-accent-red text-[13px] font-medium hover:bg-red-50 transition-colors">
                  {t('customers.deleteBtn')}
                </button>
              </div>
            </div>
          </div>
        </ModalOverlay>
      )}
    </div>
  );
}
function KPICard({ icon, label, value, badge, badgeColor, isPrefix }: {
  icon: React.ReactNode; label: string; value: number | string;
  badge: string; badgeColor: string; isPrefix?: boolean;
}) {
  const badgeCls = badgeColor === 'green'
    ? 'bg-emerald-50 text-emerald-700 border-emerald-200'
    : 'bg-surface text-text-muted border-border';
  return (
    <div className="card px-5 py-4">
      <div className="flex items-center gap-2 mb-2">
        {icon}
        <p className="text-[10.5px] font-semibold text-text-muted tracking-[0.08em] uppercase">{label}</p>
      </div>
      <div className="flex items-end gap-2">
        <p className="text-[22px] font-bold text-text-primary leading-tight">
          {isPrefix ? '' : ''}{value}
        </p>
        <span className={`inline-flex items-center px-1.5 py-0.5 rounded-full text-[10px] font-semibold border ${badgeCls}`}>
          {badge}
        </span>
      </div>
    </div>
  );
}
function FormField({ label, required, children }: { label: string; required?: boolean; children: React.ReactNode }) {
  return (
    <div>
      <label className="block text-[12px] font-semibold text-text-secondary mb-1.5">
        {label}{required && <span className="text-accent-red ml-0.5">*</span>}
      </label>
      {children}
    </div>
  );
}
function DetailRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between py-2 border-b border-border-light">
      <span className="text-text-muted">{label}</span>
      <span className="font-medium text-text-primary">{value}</span>
    </div>
  );
}
function ModalOverlay({ children, onClose }: { children: React.ReactNode; onClose: () => void }) {
  return (
    <div className="fixed inset-0 bg-black/30 backdrop-blur-[2px] flex items-center justify-center z-50 p-4" onClick={onClose}>
      <div onClick={(e) => e.stopPropagation()}>{children}</div>
    </div>
  );
}
