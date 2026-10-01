"use client";

import { useState } from "react";
import { Building2, Home, Wifi } from "lucide-react";
import { Input } from "@/components/arc/components/input/input";
import { Textarea } from "@/components/arc/components/textarea/textarea";
import { Select } from "@/components/arc/components/select/select";
import { Combobox } from "@/components/arc/components/combobox/combobox";
import { Checkbox } from "@/components/arc/components/checkbox/checkbox";
import { Switch } from "@/components/arc/components/switch/switch";
import { MultiSelect } from "@/components/arc/components/multi-select/multi-select";
import { NumberField } from "@/components/arc/components/number-field/number-field";
import { PasswordField } from "@/components/arc/components/password-field/password-field";
import { SearchField } from "@/components/arc/components/search-field/search-field";
import { TagInput } from "@/components/arc/components/tag-input/tag-input";
import { FileDropzone } from "@/components/arc/components/file-dropzone/file-dropzone";
import { RadioGroup } from "@/components/arc/components/radio-group/radio-group";
import SegmentedControl from "@/components/arc/components/segmented-control/segmented-control";
import { Calendar } from "@/components/arc/components/calendar/calendar";
import { DatePicker } from "@/components/arc/components/date-picker/date-picker";
import { TimePicker } from "@/components/arc/components/time-picker/time-picker";
import { Slider } from "@/components/arc/components/slider/slider";
import { InlineEdit } from "@/components/arc/components/inline-edit/inline-edit";
import { ExpandingSearch } from "@/components/arc/components/expanding-search/expanding-search";
import { ChipGroup } from "@/components/arc/components/chip-group/chip-group";
import { PasswordStrength } from "@/components/arc/components/password-strength/password-strength";
import { SignaturePad } from "@/components/arc/components/signature-pad/signature-pad";
import { DateRangePicker } from "@/components/arc/components/date-range-picker/date-range-picker";
import { ColorPicker } from "@/components/arc/components/color-picker/color-picker";
import { PhoneInput } from "@/components/arc/components/phone-input/phone-input";
import { ShortcutRecorder } from "@/components/arc/components/shortcut-recorder/shortcut-recorder";
import { MentionInput } from "@/components/arc/components/mention-input/mention-input";
import { RichTextEditor } from "@/components/arc/components/rich-text-editor/rich-text-editor";
import { BillingPrice, BillingToggle } from "@/components/arc/components/billing-toggle/billing-toggle";
import { RadioCards } from "@/components/arc/components/radio-cards/radio-cards";
import { type ArcDemo, wait } from "./gallery-context";
import styles from "./demos.module.css";

const STATES = ["Johor", "Kedah", "Kelantan", "Melaka", "Negeri Sembilan", "Pahang", "Perak", "Perlis", "Pulau Pinang", "Sabah", "Sarawak", "Selangor", "Terengganu", "W.P. Kuala Lumpur", "W.P. Labuan", "W.P. Putrajaya"];
const stateOptions = STATES.map((state) => ({ value: state, label: state }));
const AGENTS = ["Aiboot", "Brian Tan", "Calvin", "Sofie", "Louis Lin"];

function InputDemo() {
  return <div className={styles.stack}><Input label="Full name" placeholder="As per MyKad" description="Exactly as printed on the ID card." /></div>;
}

function TextareaDemo() {
  return <div className={styles.stack}><Textarea label="Additional remarks" placeholder="Anything the installer should know" /></div>;
}

function SelectDemo() {
  return <div className={styles.stack}><Select label="State" placeholder="Choose a state" options={stateOptions} /></div>;
}

function ComboboxDemo() {
  return <div className={styles.stack}><Combobox label="State" placeholder="Search states" options={stateOptions} /></div>;
}

function CheckboxDemo() {
  return (
    <div className={styles.stack}>
      <Checkbox label="Stop before Pay" description="The run fills every page but never presses Pay." defaultChecked />
      <Checkbox label="Email me when it finishes" />
    </div>
  );
}

function SwitchDemo() {
  return <div className={styles.stack}><Switch label="Automatic retry" defaultChecked /><Switch label="Order entry access" /></div>;
}

function MultiSelectDemo() {
  return <div className={styles.stack}><MultiSelect label="Agents" options={AGENTS.map((a) => ({ value: a, label: a }))} /></div>;
}

function NumberFieldDemo() {
  return <div className={styles.stack}><NumberField label="Appointment lead time" defaultValue={12} min={0} max={72} suffix=" h" /></div>;
}

function PasswordFieldDemo() {
  return <div className={styles.stack}><PasswordField label="Dealer password" /></div>;
}

function SearchFieldDemo() {
  const [value, setValue] = useState("");
  return <div className={styles.stack}><SearchField label="Search cases" placeholder="Name, case no, order ID" value={value} onValueChange={setValue} /></div>;
}

function TagInputDemo() {
  return <div className={styles.stack}><TagInput label="Keywords" defaultValue={["fibre", "300Mbps"]} /></div>;
}

function FileDropzoneDemo() {
  return (
    <div className={styles.fill}>
      <FileDropzone
        label="Supporting documents"
        description="MyKad, utility bill or IM conversation"
        accept="image/*,application/pdf"
        multiple
        onUpload={async (_item, { onProgress }) => { for (let p = 20; p <= 100; p += 20) { await wait(180); onProgress(p); } }}
      />
    </div>
  );
}

function RadioGroupDemo() {
  const [value, setValue] = useState("first");
  return (
    <RadioGroup
      label="Booking policy"
      value={value}
      onValueChange={setValue}
      options={[
        { value: "first", label: "First available slot", description: "After the lead time." },
        { value: "fixed", label: "A fixed date", description: "Fails if that day is full." },
      ]}
    />
  );
}

function SegmentedControlDemo() {
  const [value, setValue] = useState("week");
  return (
    <SegmentedControl
      value={value}
      onValueChange={setValue}
      options={[{ value: "day", label: "Day" }, { value: "week", label: "Week" }, { value: "month", label: "Month" }]}
    />
  );
}

function CalendarDemo() {
  const [date, setDate] = useState<Date | undefined>(undefined);
  return <Calendar value={date} onChange={setDate} />;
}

function DatePickerDemo() {
  return <div className={styles.stack}><DatePicker label="Installation date" /></div>;
}

function TimePickerDemo() {
  return <div className={styles.stack}><TimePicker label="Installation time" /></div>;
}

function SliderDemo() {
  return <div className={styles.stack}><Slider label="Retry budget" defaultValue={3} min={0} max={10} /></div>;
}

function InlineEditDemo() {
  const [value, setValue] = useState("Unifi Home 300Mbps");
  return <InlineEdit label="Package" value={value} onSave={async (next) => { await wait(500); setValue(next); }} />;
}

function ExpandingSearchDemo() {
  return (
    <ExpandingSearch
      label="Search orders"
      items={[
        { id: "1", title: "ORD-0275", meta: "Lin Chin Chean · Failed", group: "Orders" },
        { id: "2", title: "ORD-0276", meta: "Wojak Lang · Submitted", group: "Orders" },
        { id: "3", title: "202655047", meta: "Bazza Tech Enterprise", group: "Cases" },
      ]}
    />
  );
}

function ChipGroupDemo() {
  const [value, setValue] = useState(["home"]);
  return (
    <ChipGroup
      label="Modules"
      value={value}
      onValueChange={setValue}
      options={[{ value: "home", label: "Home Fibre" }, { value: "biz", label: "Business Fibre" }, { value: "4g", label: "4G / 5G" }]}
    />
  );
}

function PasswordStrengthDemo() {
  return <div className={styles.stack}><PasswordStrength label="New password" /></div>;
}

function SignaturePadDemo() {
  return <div className={styles.fill}><SignaturePad signer="Property owner" /></div>;
}

function DateRangePickerDemo() {
  return <div className={styles.stack}><DateRangePicker label="Crawl window" /></div>;
}

function ColorPickerDemo() {
  return <ColorPicker />;
}

function PhoneInputDemo() {
  return <div className={styles.stack}><PhoneInput label="Contact number" defaultCountry="MY" /></div>;
}

function ShortcutRecorderDemo() {
  return <div className={styles.stack}><ShortcutRecorder label="Submit shortcut" defaultValue="mod+enter" /></div>;
}

function MentionInputDemo() {
  return (
    <div className={styles.fill}>
      <MentionInput
        placeholder="Type @ to mention an agent, # for a channel"
        people={AGENTS.map((name) => ({ id: name, name }))}
        channels={[{ id: "orders", name: "orders", description: "Order Entry" }, { id: "crawls", name: "crawls" }]}
      />
    </div>
  );
}

function RichTextEditorDemo() {
  return (
    <div className={styles.fill}>
      <RichTextEditor aria-label="Order note" defaultMarkdown={"## Installer note\n\nCustomer prefers **mornings**. Gate code is with the guard."} />
    </div>
  );
}

function BillingToggleDemo() {
  const [value, setValue] = useState("monthly");
  return (
    <div className={styles.stack}>
      <BillingToggle
        value={value}
        onValueChange={setValue}
        options={[{ value: "monthly", label: "Monthly" }, { value: "yearly", label: "Yearly", badge: "Save 15%" }]}
      />
      <BillingPrice amount={value === "monthly" ? 129 : 1316} currency="MYR" period={value === "monthly" ? "/month" : "/year"} />
    </div>
  );
}

function RadioCardsDemo() {
  return (
    <div className={styles.fill}>
      <RadioCards
        defaultValue="home"
        options={[
          { value: "home", label: "Home Fibre", description: "Residential", icon: <Home size={18} /> },
          { value: "biz", label: "Business Fibre", description: "Company with SSM", icon: <Building2 size={18} /> },
          { value: "4g", label: "4G / 5G", description: "Wireless", icon: <Wifi size={18} />, disabled: true, disabledReason: "Not offered yet" },
        ]}
      />
    </div>
  );
}

export const INPUT_DEMOS: Record<string, ArcDemo> = {
  input: InputDemo,
  textarea: TextareaDemo,
  select: SelectDemo,
  combobox: ComboboxDemo,
  checkbox: CheckboxDemo,
  switch: SwitchDemo,
  "multi-select": MultiSelectDemo,
  "number-field": NumberFieldDemo,
  "password-field": PasswordFieldDemo,
  "search-field": SearchFieldDemo,
  "tag-input": TagInputDemo,
  "file-dropzone": FileDropzoneDemo,
  "radio-group": RadioGroupDemo,
  "segmented-control": SegmentedControlDemo,
  calendar: CalendarDemo,
  "date-picker": DatePickerDemo,
  "time-picker": TimePickerDemo,
  slider: SliderDemo,
  "inline-edit": InlineEditDemo,
  "expanding-search": ExpandingSearchDemo,
  "chip-group": ChipGroupDemo,
  "password-strength": PasswordStrengthDemo,
  "signature-pad": SignaturePadDemo,
  "date-range-picker": DateRangePickerDemo,
  "color-picker": ColorPickerDemo,
  "phone-input": PhoneInputDemo,
  "shortcut-recorder": ShortcutRecorderDemo,
  "mention-input": MentionInputDemo,
  "rich-text-editor": RichTextEditorDemo,
  "billing-toggle": BillingToggleDemo,
  "radio-cards": RadioCardsDemo,
};
