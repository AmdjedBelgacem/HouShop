import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { invoke, convertFileSrc } from '@tauri-apps/api/core';
import { useI18n } from '../i18n';
import type { CreateCustomer, UpdateCustomer, CustomerWithStats } from '../lib/types';
import CustomSelect from '../components/CustomSelect';
import {
  ArrowLeft, User, MapPin, Settings, Camera, Calendar, ChevronDown,
} from 'lucide-react';
interface AddCustomerProps {
  onBack: () => void;
  editCustomer?: CustomerWithStats | null;
}
export default function AddCustomer({ onBack, editCustomer }: AddCustomerProps) {
  const isEditing = !!editCustomer;
  const queryClient = useQueryClient();
  const { t } = useI18n();
  const addressParts = editCustomer?.address?.split(', ') ?? [];
  const algerianCities = [
    'Algiers', 'Oran', 'Constantine', 'Annaba', 'Blida', 'Batna', 'Sétif', 'Djelfa',
    'Biskra', 'Tlemcen', 'Béjaïa', 'Tizi Ouzou', 'Chlef', 'Médéa', 'Mostaganem',
    'El Oued', 'Ghardaïa', 'Ouargla', 'Skikda', 'Bordj Bou Arréridj',
    'Jijel', 'Mila', 'Ain Defla', 'Mascara', 'Tiaret', 'Saïda', 'Laghouat',
    'Tébessa', 'M\'Sila', 'Naâma', 'Béchar', 'Adrar', 'Tamanrasset', 'Illizi',
  ];
  const countryOptions = [
    { value: 'Algeria', label: 'Algeria' },
    { value: 'France', label: 'France' },
    { value: 'Tunisia', label: 'Tunisia' },
    { value: 'Morocco', label: 'Morocco' },
    { value: 'United States', label: 'United States' },
    { value: 'Canada', label: 'Canada' },
    { value: 'United Kingdom', label: 'United Kingdom' },
    { value: 'China', label: 'China' },
  ];
  const groupOptions = [
    { value: 'Regular', label: 'Regular' },
    { value: 'VIP', label: 'VIP' },
    { value: 'Wholesale', label: 'Wholesale' },
    { value: 'Staff', label: 'Staff' },
  ];
  const [form, setForm] = useState({
    name: editCustomer?.name ?? '',
    email: editCustomer?.email ?? '',
    phone: editCustomer?.phone ?? '',
    dob: '',
    address: addressParts[0] ?? '',
    city: addressParts[1] ?? '',
    country: addressParts[2] ?? 'Algeria',
    postal_code: addressParts[3] ?? '',
    customer_group: 'Regular',
    marketing_opt_in: true,
    notes: editCustomer?.notes ?? '',
    photo_path: editCustomer?.photo_path ?? null,
  });
  const createMutation = useMutation({
    mutationFn: (data: CreateCustomer) => invoke('create_customer', { data }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['customers-with-stats'] });
      queryClient.invalidateQueries({ queryKey: ['customer-stats'] });
      queryClient.invalidateQueries({ queryKey: ['dashboard-stats'] });
      queryClient.invalidateQueries({ queryKey: ['customers'] });
      onBack();
    },
  });
  const updateMutation = useMutation({
    mutationFn: (data: UpdateCustomer) => invoke('update_customer', { data }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['customers-with-stats'] });
      queryClient.invalidateQueries({ queryKey: ['customer-stats'] });
      queryClient.invalidateQueries({ queryKey: ['dashboard-stats'] });
      queryClient.invalidateQueries({ queryKey: ['customers'] });
      onBack();
    },
  });
  const handleSubmit = () => {
    const fullAddress = [form.address, form.city, form.country, form.postal_code]
      .filter(Boolean).join(', ');
    const payload = {
      name: form.name,
      email: form.email || null,
      phone: form.phone || null,
      address: fullAddress || null,
      notes: form.notes || null,
      photo_path: form.photo_path,
      party_type: 'customer',
    };
    if (isEditing && editCustomer) {
      updateMutation.mutate({ id: editCustomer.id, ...payload });
    } else {
      createMutation.mutate(payload);
    }
  };
  const handlePhotoSelect = async () => {
    const input = document.createElement('input');
    input.type = 'file'; input.accept = 'image/*';
    input.onchange = async (e) => {
      const file = (e.target as HTMLInputElement).files?.[0];
      if (!file) return;
      await processImageFile(file);
    };
    input.click();
  };
  const processImageFile = async (file: File) => {
    const reader = new FileReader();
    reader.onload = async () => {
      try {
        const path = await invoke<string>('save_image', { data: reader.result as string, filename: file.name });
        setForm(f => ({ ...f, photo_path: path }));
      } catch (err) { console.error(err); }
    };
    reader.readAsDataURL(file);
  };
  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
  };
  const handleDrop = async (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    const files = e.dataTransfer.files;
    if (files.length > 0) {
      const file = files[0];
      if (file.type.startsWith('image/')) {
        await processImageFile(file);
      }
    }
  };
  return (
    <div className="p-8">
      {}
      <div className="flex items-start justify-between mb-8">
        <div>
          <div className="flex items-center gap-3 mb-1">
            <button onClick={onBack} className="p-1.5 rounded-lg hover:bg-card border border-transparent hover:border-border transition-colors">
              <ArrowLeft size={20} />
            </button>
            <h2 className="text-[26px] font-bold text-text-primary leading-tight">{isEditing ? t('addCustomer.editTitle') : t('addCustomer.title')}</h2>
          </div>
          <p className="text-[14px] text-text-secondary ml-11">
            {isEditing ? t('addCustomer.editSubtitle') : t('addCustomer.newSubtitle')}
          </p>
        </div>
        <div className="flex items-center gap-2.5">
          <button onClick={onBack}
            className="px-5 py-2.5 rounded-lg border border-border text-[13px] font-medium text-text-secondary hover:bg-card transition-colors">
            {t('common.cancel')}
          </button>
          <button onClick={handleSubmit} disabled={!form.name || createMutation.isPending}
            className="px-6 py-2.5 rounded-lg bg-navy text-white text-[13px] font-medium hover:bg-navy-light disabled:opacity-50 transition-colors">
            {createMutation.isPending || updateMutation.isPending ? t('addCustomer.saving') : (isEditing ? t('addCustomer.saveChanges') : t('addCustomer.saveCustomer'))}
          </button>
        </div>
      </div>
      {}
      <div className="grid grid-cols-3 gap-6">
        {}
        <div className="col-span-2 space-y-6">
          {}
          <section className="card p-6">
            <div className="flex items-center gap-2 mb-5">
              <User size={16} className="text-text-muted" />
              <h3 className="text-[15px] font-bold text-text-primary">{t('addCustomer.personalInfo')}</h3>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <Field label={t('addCustomer.nameLabel')} required>
                <input type="text" required value={form.name}
                  onChange={(e) => setForm(f => ({ ...f, name: e.target.value }))}
                  className="form-input" placeholder={t('addCustomer.fullNamePh')} />
              </Field>
              <Field label={t('addCustomer.emailLabel')}>
                <input type="email" value={form.email}
                  onChange={(e) => setForm(f => ({ ...f, email: e.target.value }))}
                  className="form-input" placeholder="j.doe@example.com" />
              </Field>
              <Field label={t('addCustomer.phoneLabel')}>
                <input type="text" value={form.phone}
                  onChange={(e) => setForm(f => ({ ...f, phone: e.target.value }))}
                  className="form-input" placeholder="+1 (555) 000-0000" />
              </Field>
              <Field label={t('addCustomer.dobLabel')}>
                <div className="relative">
                  <input type="text" value={form.dob}
                    onChange={(e) => setForm(f => ({ ...f, dob: e.target.value }))}
                    className="form-input pr-10" placeholder={t('addCustomer.dobFormat')} />
                  <Calendar size={16} className="absolute right-3 top-1/2 -translate-y-1/2 text-text-muted" />
                </div>
              </Field>
            </div>
          </section>
          {}
          <section className="card p-6">
            <div className="flex items-center gap-2 mb-5">
              <MapPin size={16} className="text-text-muted" />
              <h3 className="text-[15px] font-bold text-text-primary">{t('addCustomer.shippingBilling')}</h3>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="col-span-2">
                <Field label={t('addCustomer.streetAddress')}>
                  <input type="text" value={form.address}
                    onChange={(e) => setForm(f => ({ ...f, address: e.target.value }))}
                    className="form-input" placeholder={t('addCustomer.streetPh')} />
                </Field>
              </div>
              <Field label={t('addCustomer.city')}>
                <CustomSelect
                  value={form.city}
                  onChange={(v) => setForm(f => ({ ...f, city: v }))}
                  options={[{ value: '', label: t('addCustomer.selectCity') }, ...algerianCities.map(c => ({ value: c, label: c }))]}
                  placeholder={t('addCustomer.selectCity')}
                />
              </Field>
              <Field label={t('addCustomer.country')}>
                <CustomSelect
                  value={form.country}
                  onChange={(v) => setForm(f => ({ ...f, country: v }))}
                  options={countryOptions}
                  placeholder={t('addCustomer.selectCountry')}
                />
              </Field>
              <Field label={t('addCustomer.postalCode')}>
                <input type="text" value={form.postal_code}
                  onChange={(e) => setForm(f => ({ ...f, postal_code: e.target.value }))}
                  className="form-input" placeholder={t('addCustomer.postalPh')} />
              </Field>
            </div>
          </section>
        </div>
        {}
        <div className="space-y-6">
          {}
          <section className="card p-6 flex flex-col items-center text-center">
            <div className="relative mb-3">
              <div
                className="w-24 h-24 rounded-full bg-surface border-2 border-border flex items-center justify-center overflow-hidden cursor-pointer hover:border-navy/30 transition-colors"
                onClick={handlePhotoSelect}
                onDragOver={handleDragOver}
                onDrop={handleDrop}
              >
                {form.photo_path ? (
                  <img src={convertFileSrc(form.photo_path)} alt="Customer" className="w-full h-full object-cover" />
                ) : (
                  <User size={36} className="text-text-muted" />
                )}
              </div>
              <button onClick={handlePhotoSelect}
                className="absolute bottom-0 right-0 w-8 h-8 rounded-full bg-navy text-white flex items-center justify-center shadow-lg hover:bg-navy-light transition-colors">
                <Camera size={14} />
              </button>
            </div>
            <p className="text-[13px] font-semibold text-text-primary">{t('addCustomer.photoTitle')}</p>
            <p className="text-[11px] text-text-muted mt-0.5 mb-3">{t('addCustomer.photoDesc')}</p>
            <button onClick={handlePhotoSelect}
              className="px-4 py-2 rounded-lg border border-border text-[12px] font-medium text-text-secondary hover:bg-card transition-colors">
              {t('addCustomer.uploadImage')}
            </button>
          </section>
          {}
          <section className="card p-6">
            <div className="flex items-center gap-2 mb-5">
              <Settings size={16} className="text-text-muted" />
              <h3 className="text-[15px] font-bold text-text-primary">{t('addCustomer.preferences')}</h3>
            </div>
            <div className="space-y-4">
              <Field label={t('addCustomer.customerGroup')}>
                <CustomSelect
                  value={form.customer_group}
                  onChange={(v) => setForm(f => ({ ...f, customer_group: v }))}
                  options={groupOptions}
                  placeholder={t('addCustomer.selectGroup')}
                />
              </Field>
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-[11px] font-semibold text-text-muted tracking-[0.06em] uppercase">{t('addCustomer.newsletters')}</p>
                  <p className="text-[12px] text-text-secondary mt-0.5">{t('addCustomer.marketingOptIn')}</p>
                </div>
                <button onClick={() => setForm(f => ({ ...f, marketing_opt_in: !form.marketing_opt_in }))}
                  className={`relative w-10 h-[22px] rounded-full transition-colors ${form.marketing_opt_in ? 'bg-navy' : 'bg-border'}`}>
                  <span className={`absolute top-[3px] w-4 h-4 rounded-full bg-white shadow transition-transform ${form.marketing_opt_in ? 'left-[21px]' : 'left-[3px]'}`} />
                </button>
              </div>
            </div>
          </section>
          {}
          <section className="card p-6">
            <Field label={t('addCustomer.internalNotes')}>
              <textarea value={form.notes}
                onChange={(e) => setForm(f => ({ ...f, notes: e.target.value }))}
                className="form-input min-h-[80px] resize-y"
                placeholder={t('addCustomer.notesPlaceholder')} />
            </Field>
          </section>
        </div>
      </div>
    </div>
  );
}
function Field({ label, required, children }: { label: string; required?: boolean; children: React.ReactNode }) {
  return (
    <div>
      <label className="block text-[11px] font-semibold text-text-muted tracking-[0.06em] uppercase mb-1.5">
        {label}{required && <span className="text-accent-red ml-0.5">*</span>}
      </label>
      {children}
    </div>
  );
}
