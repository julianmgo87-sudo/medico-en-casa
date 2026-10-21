export type ProAppt = {
  id: string; code: string; status: string; status_label: string; care_type: string; starts_at: string; ends_at: string; duration_min: number;
  response_deadline: string | null; specialty: string; area_name: string | null; neighborhood: string | null; patient_notes: string | null;
  patient_name: string | null; patient_phone: string | null;
  address: { address_line?: string; neighborhood?: string; reference_notes?: string; area_name?: string } | null;
  professional_net_amount: number; commission_amount: number; gross_amount: number;
};
