import React from 'react';
import { QrCode } from 'lucide-react';
import { Field, inputCls } from './ui';
import type { DraftTemplate, FieldErrors } from './templateModel';

type BasicField = Exclude<keyof DraftTemplate, 'items'>;

interface BasicInfoTabProps {
  draft: DraftTemplate;
  errors: FieldErrors;
  isNew: boolean;
  /** Errors that only the server can know (duplicate part number or sheet ID). */
  serverErrors: FieldErrors;
  onChange: (field: BasicField, value: string) => void;
  onScan: () => void;
}

export const BasicInfoTab: React.FC<BasicInfoTabProps> = ({ draft, errors, isNew, serverErrors, onChange, onScan }) => {
  const err = (f: string) => errors[f] || serverErrors[f];

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h3 className="text-base font-semibold text-[var(--ink)]">Basic information</h3>
          <p className="sub mt-0.5">Identifies the part this checksheet is for. It appears on reports and printed labels.</p>
        </div>
        <button type="button" className="btn sm" onClick={onScan} title="Scan a part number barcode or QR">
          <QrCode className="w-3.5 h-3.5" />
          <span>Scan part number</span>
        </button>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <Field label="Template name" htmlFor="tpl-title" required error={err('document_title')} hint="Shown as the title of the checksheet and its reports." className="md:col-span-2">
          <input
            id="tpl-title"
            value={draft.document_title}
            onChange={(e) => onChange('document_title', e.target.value)}
            placeholder="e.g. Initial flow management checksheet, purge line pipe"
            className={inputCls(err('document_title'))}
          />
        </Field>

        <Field label="Part number" htmlFor="tpl-part-no" error={err('part_no')} hint="Each part number can belong to one template.">
          <input
            id="tpl-part-no"
            value={draft.part_no}
            onChange={(e) => onChange('part_no', e.target.value)}
            placeholder="e.g. 18351M62Q50"
            className={`${inputCls(err('part_no'))} mono`}
          />
        </Field>

        <Field label="Part name" htmlFor="tpl-part-name" error={err('part_name')}>
          <input
            id="tpl-part-name"
            value={draft.part_name}
            onChange={(e) => onChange('part_name', e.target.value)}
            placeholder="e.g. Pipe, purge line (RH)"
            className={inputCls()}
          />
        </Field>

        <Field label="Category" htmlFor="tpl-category" error={err('part_category')}>
          <select
            id="tpl-category"
            value={draft.part_category}
            onChange={(e) => onChange('part_category', e.target.value)}
            className={`${inputCls()} cursor-pointer`}
          >
            <option value="MAIN PART">Main part</option>
            <option value="CHILD PART">Child part</option>
          </select>
        </Field>

        <Field
          label="Sheet ID"
          htmlFor="tpl-sheet-id"
          required={isNew}
          error={err('sheet_id')}
          hint={isNew ? 'Used for the QR code and barcode. It cannot be changed after saving.' : 'Fixed after the template is created.'}
        >
          <input
            id="tpl-sheet-id"
            value={draft.sheet_id}
            onChange={(e) => onChange('sheet_id', e.target.value)}
            disabled={!isNew}
            placeholder="e.g. IFM-18351M62Q50"
            className={`${inputCls(err('sheet_id'))} mono`}
          />
        </Field>

        <Field label="Model" htmlFor="tpl-model" error={err('model_name')}>
          <input
            id="tpl-model"
            value={draft.model_name}
            onChange={(e) => onChange('model_name', e.target.value)}
            placeholder="e.g. YTA MC26 fuel line"
            className={inputCls()}
          />
        </Field>

        <Field label="Vendor" htmlFor="tpl-vendor" error={err('vendor_name')}>
          <input
            id="tpl-vendor"
            value={draft.vendor_name}
            onChange={(e) => onChange('vendor_name', e.target.value)}
            placeholder="Vendor name"
            className={inputCls()}
          />
        </Field>

        <Field label="Customer" htmlFor="tpl-customer" error={err('customer_name')}>
          <input
            id="tpl-customer"
            value={draft.customer_name}
            onChange={(e) => onChange('customer_name', e.target.value)}
            placeholder="Customer name"
            className={inputCls()}
          />
        </Field>
      </div>
    </div>
  );
};
