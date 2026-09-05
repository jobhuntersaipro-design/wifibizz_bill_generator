/**
 * The wording of a standard Malaysian residential tenancy agreement.
 *
 * Frozen commercial terms live in `tenancy-fields.ts`. This file is only the
 * clause text the drawer paginates — kept out of the PDF module so a wording
 * change cannot hide inside drawing code.
 */

import {
  ACCESS_CARD_DEPOSIT,
  BANK_ACCOUNT_NAME,
  BANK_ACCOUNT_NO,
  BANK_NAME,
  MONTHLY_RENTAL_TEXT,
  PERMITTED_USE,
  RENEWAL_LABEL,
  RENT_DUE,
  SECURITY_DEPOSIT,
  SECURITY_DEPOSIT_NOTE,
  TERM_LABEL,
  TERM_MONTHS,
  UTILITY_DEPOSIT,
  type TenancyFields,
} from './tenancy-fields';

export type Block =
  | { kind: 'title'; text: string }
  | { kind: 'center'; text: string }
  | { kind: 'para'; text: string }
  | { kind: 'heading'; text: string }
  | { kind: 'clause'; ref: string; text: string }
  | { kind: 'gap' }
  | { kind: 'page-break' };

function parties(f: TenancyFields): string {
  const landlordIc = f.landlordIc ? ` (NRIC No. ${f.landlordIc})` : '';
  const tenantIc = f.tenantIc ? ` (NRIC No. ${f.tenantIc})` : '';
  return (
    `This Agreement is made the ${f.agreementDate} BETWEEN ${f.landlordName}` +
    `${landlordIc} of the address set out in the First Schedule (hereinafter ` +
    `called "the Landlord") of the one part AND ${f.tenantName}${tenantIc} ` +
    `(hereinafter called "the Tenant") of the other part.`
  );
}

export function agreementBlocks(f: TenancyFields): Block[] {
  const premises = f.premises || 'THE PREMISES DESCRIBED IN THE FIRST SCHEDULE';
  return [
    { kind: 'title', text: 'TENANCY AGREEMENT' },
    { kind: 'center', text: '(Residential)' },
    { kind: 'gap' },
    { kind: 'para', text: parties(f) },
    { kind: 'gap' },
    { kind: 'heading', text: 'RECITALS' },
    {
      kind: 'para',
      text:
        `WHEREAS the Landlord is the beneficial owner of the premises known as ` +
        `${premises} (hereinafter called "the Demised Premises").`,
    },
    {
      kind: 'para',
      text:
        'AND WHEREAS the Landlord has agreed to let and the Tenant has agreed to take ' +
        'a tenancy of the Demised Premises for the term, at the rent and upon the ' +
        'terms set out in this Agreement and the First Schedule.',
    },
    {
      kind: 'para',
      text:
        'NOW THIS AGREEMENT WITNESSETH as follows:',
    },

    { kind: 'heading', text: '1. DEFINITIONS AND INTERPRETATION' },
    {
      kind: 'clause',
      ref: '1.1',
      text:
        'In this Agreement, unless the context otherwise requires, "Demised Premises" ' +
        'means the premises described in Item 1 of the First Schedule together with ' +
        'the fixtures, fittings and appurtenances belonging thereto.',
    },
    {
      kind: 'clause',
      ref: '1.2',
      text:
        `"Term" means the period of ${TERM_LABEL} commencing on the date in Item 4 of ` +
        'the First Schedule and expiring on the date in Item 5 thereof, together with ' +
        'any extension granted under clause 9.',
    },
    {
      kind: 'clause',
      ref: '1.3',
      text:
        '"Rent" means the monthly rental set out in Item 6 of the First Schedule, ' +
        'inclusive of the extra car-park charge there stated.',
    },
    {
      kind: 'clause',
      ref: '1.4',
      text:
        '"Deposits" means the security deposit, utility deposit and access-card deposit ' +
        'set out in Items 8, 9 and 10 of the First Schedule.',
    },
    {
      kind: 'clause',
      ref: '1.5',
      text:
        'Words importing the singular include the plural and vice versa, and words ' +
        'importing one gender include the other. Headings are for convenience only ' +
        'and do not affect interpretation. A reference to a statute includes any ' +
        'amendment or re-enactment of it.',
    },
    {
      kind: 'clause',
      ref: '1.6',
      text:
        'If two or more persons are named as the Tenant, their covenants are joint ' +
        'and several. "Landlord" and "Tenant" include their respective successors, ' +
        'permitted assigns, personal representatives and, where the context admits, ' +
        'their servants and agents.',
    },

    { kind: 'heading', text: '2. DEMISE' },
    {
      kind: 'clause',
      ref: '2.1',
      text:
        'In consideration of the Rent and the Tenant\'s covenants, the Landlord lets ' +
        'and the Tenant takes the Demised Premises for the Term, together with the ' +
        'right to use the extra car-park bay referred to in Item 6 of the First ' +
        'Schedule, for the permitted use only.',
    },
    {
      kind: 'clause',
      ref: '2.2',
      text:
        'The Tenant acknowledges having inspected the Demised Premises before the ' +
        'date of this Agreement and taking them in their present state and condition, ' +
        'fair wear and tear excepted as provided below.',
    },

    { kind: 'heading', text: '3. TERM' },
    {
      kind: 'clause',
      ref: '3.1',
      text:
        `The tenancy shall be for ${TERM_LABEL} commencing on ${f.commenceDate} and ` +
        `expiring on ${f.expireDate}, with an option to renew for ${RENEWAL_LABEL} ` +
        'as provided in clause 9.',
    },
    {
      kind: 'clause',
      ref: '3.2',
      text:
        `Time is of the essence of this Agreement. The Term of ${TERM_MONTHS} months ` +
        'shall not be shortened except by written agreement or as this Agreement ' +
        'expressly allows.',
    },

    { kind: 'heading', text: '4. RENT' },
    {
      kind: 'clause',
      ref: '4.1',
      text:
        `The Tenant shall pay the Rent of ${MONTHLY_RENTAL_TEXT} ${RENT_DUE}, ` +
        'the first payment to be made on or before the commencement date.',
    },
    {
      kind: 'clause',
      ref: '4.2',
      text:
        `Payment shall be made by transfer to ${BANK_NAME}, ACCOUNT NAME: ` +
        `${BANK_ACCOUNT_NAME}, ACCOUNT NO: ${BANK_ACCOUNT_NO}, or to such other ` +
        'account as the Landlord may notify in writing.',
    },
    {
      kind: 'clause',
      ref: '4.3',
      text:
        'Rent is payable without deduction, set-off or counterclaim. A receipt or ' +
        'bank confirmation is conclusive evidence of payment. Late payment does not ' +
        'waive the Landlord\'s other remedies.',
    },
    {
      kind: 'clause',
      ref: '4.4',
      text:
        'If any Rent remains unpaid for seven (7) days after it falls due, the Tenant ' +
        'shall pay interest at eight per cent (8%) per annum on the unpaid amount, ' +
        'calculated daily from the due date until payment, without prejudice to the ' +
        'Landlord\'s right of re-entry.',
    },

    { kind: 'heading', text: '5. DEPOSITS' },
    {
      kind: 'clause',
      ref: '5.1',
      text:
        `Upon signing this Agreement the Tenant shall pay a security deposit of ` +
        `${SECURITY_DEPOSIT} (${SECURITY_DEPOSIT_NOTE}), a utility deposit of ` +
        `${UTILITY_DEPOSIT}, and an access-card deposit of ${ACCESS_CARD_DEPOSIT}.`,
    },
    {
      kind: 'clause',
      ref: '5.2',
      text:
        'The security deposit is held against any breach of this Agreement, including ' +
        'unpaid Rent, damage beyond fair wear and tear, and the cost of restoring the ' +
        'Demised Premises. It is not rent in advance and may not be set off against ' +
        'the last months of the Term without the Landlord\'s written consent.',
    },
    {
      kind: 'clause',
      ref: '5.3',
      text:
        'The utility deposit is held against water, electricity, sewerage, internet ' +
        'and other charges incurred during the Term. The access-card deposit is held ' +
        'against loss of or damage to any access card, key tag or remote issued to ' +
        'the Tenant.',
    },
    {
      kind: 'clause',
      ref: '5.4',
      text:
        'Subject to any lawful deduction, the Deposits shall be refunded within thirty ' +
        '(30) days after the Tenant has yielded up the Demised Premises, returned all ' +
        'keys and cards, and produced evidence that all utility accounts have been ' +
        'settled and transferred or closed.',
    },

    { kind: 'heading', text: '6. TENANT\'S COVENANTS' },
    {
      kind: 'clause',
      ref: '6.1',
      text:
        `To use the Demised Premises for ${PERMITTED_USE} and not for any trade, ` +
        'business, unlawful or immoral purpose, and not to do anything that may ' +
        'become a nuisance or annoyance to the Landlord or to adjoining occupiers.',
    },
    {
      kind: 'clause',
      ref: '6.2',
      text:
        'To pay the Rent and the extra car-park charge on the days and in the manner ' +
        'appointed, and to pay all charges for water, electricity, sewerage, gas, ' +
        'internet, telephone and other utilities consumed on the Demised Premises ' +
        'during the Term, together with any late-payment fees those providers levy.',
    },
    {
      kind: 'clause',
      ref: '6.3',
      text:
        'To pay the service charges, sinking fund, insurance premium (if separately ' +
        'levied on the occupier) and any other outgoing that the management ' +
        'corporation or developer lawfully requires of an occupier, if the Demised ' +
        'Premises form part of a stratified building.',
    },
    {
      kind: 'clause',
      ref: '6.4',
      text:
        'To keep the interior of the Demised Premises, including the flooring, walls, ' +
        'ceilings, doors, windows, sanitary fittings, air-conditioning units, water ' +
        'heater, kitchen cabinets and all fixtures, in good and tenantable repair, ' +
        'fair wear and tear and damage by insured risk excepted.',
    },
    {
      kind: 'clause',
      ref: '6.5',
      text:
        'To keep the Demised Premises in a clean and sanitary condition and to dispose ' +
        'of refuse only in the manner the management or local authority directs. To ' +
        'keep all drains, pipes and sanitary appliances free from obstruction.',
    },
    {
      kind: 'clause',
      ref: '6.6',
      text:
        'Not to make any alteration, addition, renovation or structural change, nor to ' +
        'drive nails or fix anything that damages the walls or finishes, without the ' +
        'Landlord\'s prior written consent. Any permitted work remains the Tenant\'s ' +
        'to remove or make good at the end of the Term as the Landlord elects.',
    },
    {
      kind: 'clause',
      ref: '6.7',
      text:
        'Not to assign, sublet, part with or share possession of the Demised Premises ' +
        'or any part, whether by way of lodging, Airbnb-style letting or otherwise, ' +
        'without the Landlord\'s prior written consent, which may be withheld without ' +
        'reason.',
    },
    {
      kind: 'clause',
      ref: '6.8',
      text:
        'Not to keep any animal, bird or pet on the Demised Premises without the ' +
        'Landlord\'s prior written consent and, where applicable, the consent of the ' +
        'management corporation.',
    },
    {
      kind: 'clause',
      ref: '6.9',
      text:
        'To comply with all written laws, by-laws, house rules and the deed of mutual ' +
        'covenant applicable to the Demised Premises, and not to do anything that ' +
        'causes the Landlord to be in breach of them.',
    },
    {
      kind: 'clause',
      ref: '6.10',
      text:
        'Not to store any combustible, dangerous or illegal substance, nor to overload ' +
        'the floors or electrical circuits, nor to install additional air-conditioning ' +
        'or high-load equipment without the Landlord\'s written consent.',
    },
    {
      kind: 'clause',
      ref: '6.11',
      text:
        'To permit the Landlord and the Landlord\'s agents, with at least twenty-four ' +
        '(24) hours\' prior notice (except in emergency), to enter and view the state ' +
        'of repair, to carry out works the Landlord is entitled to do, and during the ' +
        'last two (2) months of the Term to show the Demised Premises to prospective ' +
        'tenants or purchasers.',
    },
    {
      kind: 'clause',
      ref: '6.12',
      text:
        'To replace at the Tenant\'s cost all broken glass, fused light bulbs, damaged ' +
        'access cards and lost keys, and to service the air-conditioning units at least ' +
        'once every four (4) months, keeping the service records for the Landlord.',
    },
    {
      kind: 'clause',
      ref: '6.13',
      text:
        'To take reasonable precautions against theft, fire, flood and pest, including ' +
        'locking all doors and windows when the Demised Premises are unoccupied, and ' +
        'to notify the Landlord immediately of any damage, defect or infestation.',
    },
    {
      kind: 'clause',
      ref: '6.14',
      text:
        'Not to do anything that may void or increase the premium on any insurance the ' +
        'Landlord or the management corporation maintains, and to indemnify the ' +
        'Landlord against any such increase or loss of cover caused by the Tenant.',
    },
    {
      kind: 'clause',
      ref: '6.15',
      text:
        'To yield up the Demised Premises at the end of the Term in the state this ' +
        'Agreement requires, with all the Tenant\'s belongings removed, all rubbish ' +
        'cleared, all keys and access cards returned, and all utility accounts settled. ' +
        'Professional cleaning to a move-in standard is at the Tenant\'s cost if the ' +
        'Landlord reasonably requires it.',
    },
    {
      kind: 'clause',
      ref: '6.16',
      text:
        'To indemnify the Landlord against all claims, losses, damages and costs ' +
        'arising from the Tenant\'s use or occupation of the Demised Premises or from ' +
        'any breach of this Agreement, including injury to any person and damage to ' +
        'any property.',
    },

    { kind: 'heading', text: '7. LANDLORD\'S COVENANTS' },
    {
      kind: 'clause',
      ref: '7.1',
      text:
        'That the Tenant paying the Rent and performing the Tenant\'s covenants shall ' +
        'peaceably hold and enjoy the Demised Premises during the Term without ' +
        'interruption by the Landlord or any person claiming through the Landlord.',
    },
    {
      kind: 'clause',
      ref: '7.2',
      text:
        'To pay all quit rent, assessment, quit-related charges and, unless clause 6.3 ' +
        'places them on the Tenant, the building insurance and management charges that ' +
        'are the owner\'s liability.',
    },
    {
      kind: 'clause',
      ref: '7.3',
      text:
        'To keep the roof, main structure, external walls and common pipes in a ' +
        'wind- and watertight condition, provided the Tenant has given written notice ' +
        'of the defect and the defect is not caused by the Tenant\'s act or neglect.',
    },
    {
      kind: 'clause',
      ref: '7.4',
      text:
        'To refund the Deposits in accordance with clause 5.4. The Landlord may set ' +
        'off any sum the Tenant owes under this Agreement before refunding the balance.',
    },

    { kind: 'heading', text: '8. PROVISOS' },
    {
      kind: 'clause',
      ref: '8.1',
      text:
        'If the Rent or any part is unpaid for fourteen (14) days after becoming due ' +
        '(whether demanded or not), or if the Tenant breaches any covenant and does ' +
        'not remedy it within fourteen (14) days of written notice, or if the Tenant ' +
        'becomes bankrupt or compounds with creditors, the Landlord may re-enter the ' +
        'Demised Premises and this tenancy shall absolutely determine, without ' +
        'prejudice to any right of action for arrears or damages.',
    },
    {
      kind: 'clause',
      ref: '8.2',
      text:
        'Re-entry under clause 8.1 does not require a court order where the law ' +
        'permits peaceable re-entry. The Landlord may change the locks and treat any ' +
        'goods left behind as abandoned after fourteen (14) days\' written notice at ' +
        'the Demised Premises or the Tenant\'s last known address.',
    },
    {
      kind: 'clause',
      ref: '8.3',
      text:
        'If the Demised Premises are destroyed or so damaged by fire, flood or other ' +
        'insured risk as to be unfit for occupation, the Rent shall abate until they ' +
        'are restored, unless the damage was caused by the Tenant. Either party may ' +
        'determine this Agreement by written notice if restoration is not begun within ' +
        'three (3) months.',
    },
    {
      kind: 'clause',
      ref: '8.4',
      text:
        'No waiver of any breach is a waiver of any later breach. A delay in enforcing ' +
        'any right is not a waiver of it. Any variation of this Agreement must be in ' +
        'writing and signed by both parties.',
    },
    {
      kind: 'clause',
      ref: '8.5',
      text:
        'If any provision is held void or unenforceable, it is severed and the ' +
        'remaining provisions continue in full force. This Agreement is the entire ' +
        'agreement between the parties and supersedes every prior negotiation and ' +
        'representation relating to the Demised Premises.',
    },
    {
      kind: 'clause',
      ref: '8.6',
      text:
        'This Agreement binds the successors in title and permitted assigns of each ' +
        'party. The Landlord may assign the benefit of this Agreement on a sale of ' +
        'the Demised Premises and the Tenant shall attorn to the purchaser on request.',
    },

    { kind: 'heading', text: '9. OPTION TO RENEW' },
    {
      kind: 'clause',
      ref: '9.1',
      text:
        `The Tenant may renew this tenancy for a further term of ${RENEWAL_LABEL} ` +
        'by giving the Landlord written notice not less than two (2) months before ' +
        `the expiry date of ${f.expireDate}, provided that at the date of the notice ` +
        'and at the expiry date there is no existing breach of this Agreement.',
    },
    {
      kind: 'clause',
      ref: '9.2',
      text:
        'The renewed term is on the same covenants except this option, and at a rent ' +
        'to be agreed. If the parties cannot agree the new rent at least one (1) month ' +
        'before expiry, the option lapses and the Tenant shall yield up on the expiry ' +
        'date.',
    },

    { kind: 'heading', text: '10. NOTICES' },
    {
      kind: 'clause',
      ref: '10.1',
      text:
        'Any notice under this Agreement shall be in writing and is sufficiently ' +
        'served if delivered by hand or sent by prepaid registered post to the ' +
        'address of the party in the First Schedule, or to such other address as that ' +
        'party has notified in writing.',
    },
    {
      kind: 'clause',
      ref: '10.2',
      text:
        'A notice sent by registered post is deemed received three (3) days after ' +
        'posting. A notice delivered by hand is deemed received on the day of ' +
        'delivery if delivered before 5.00 p.m. on a business day, otherwise on the ' +
        'next business day.',
    },

    { kind: 'heading', text: '11. STAMP DUTY AND COSTS' },
    {
      kind: 'clause',
      ref: '11.1',
      text:
        'The stamp duty on this Agreement and the duplicate, and the cost of preparing ' +
        'this Agreement, shall be borne by the Tenant. Each party bears its own ' +
        'adviser\'s fees.',
    },

    { kind: 'heading', text: '12. PARKING AND ACCESS' },
    {
      kind: 'clause',
      ref: '12.1',
      text:
        'The extra car-park bay referred to in Item 6 of the First Schedule is licensed ' +
        'to the Tenant for the Term at the extra charge there stated. The Tenant shall ' +
        'park only in that bay, shall not obstruct common driveways, and shall comply ' +
        'with the management\'s parking rules.',
    },
    {
      kind: 'clause',
      ref: '12.2',
      text:
        'Access cards, key tags and remotes remain the Landlord\'s property. The Tenant ' +
        'shall not duplicate them. Loss must be reported at once; replacement is at the ' +
        `Tenant's cost and may be deducted from the access-card deposit of ${ACCESS_CARD_DEPOSIT}.`,
    },

    { kind: 'heading', text: '13. HOUSE RULES' },
    {
      kind: 'clause',
      ref: '13.1',
      text:
        'The Tenant shall not hold any party or gathering that causes noise audible ' +
        'outside the Demised Premises after 10.30 p.m., nor use common areas for ' +
        'storage, cooking or drying of laundry except where the management so allows.',
    },
    {
      kind: 'clause',
      ref: '13.2',
      text:
        'The Tenant shall not place flower pots, laundry or other articles on balconies ' +
        'or windowsills in a manner that may fall, stain the facade or breach the ' +
        'house rules. Smoking is not permitted inside the Demised Premises if the ' +
        'management or the Landlord so directs.',
    },
    {
      kind: 'clause',
      ref: '13.3',
      text:
        'The Demised Premises are let unfurnished except for the fixtures and fittings ' +
        'present on the commencement date. Any furniture the Tenant brings in must be ' +
        'removed at the end of the Term without damage to the floors or walls.',
    },

    { kind: 'heading', text: '14. GOVERNING LAW' },
    {
      kind: 'clause',
      ref: '14.1',
      text:
        'This Agreement is governed by the laws of Malaysia. The parties submit to ' +
        'the non-exclusive jurisdiction of the courts of Malaysia. Nothing in this ' +
        'clause 14 limits the Landlord\'s right to seek relief in any other competent court.',
    },
    {
      kind: 'para',
      text:
        'IN WITNESS WHEREOF the parties have hereunto set their hands the day and ' +
        'year first above written.',
    },
  ];
}

export interface ScheduleRow {
  item: string;
  label: string;
  value: string;
}

export function firstScheduleRows(f: TenancyFields): ScheduleRow[] {
  return [
    { item: '1', label: 'The Demised Premises', value: f.premises || '—' },
    { item: '2', label: 'Term', value: TERM_LABEL },
    { item: '3', label: 'Date of this Agreement', value: f.agreementDate },
    { item: '4', label: 'Date of Commencement', value: f.commenceDate },
    { item: '5', label: 'Date of Expiry', value: f.expireDate },
    { item: '6', label: 'Monthly Rental', value: MONTHLY_RENTAL_TEXT },
    { item: '7', label: 'Rent Due', value: RENT_DUE },
    {
      item: '8',
      label: 'Security Deposit',
      value: `${SECURITY_DEPOSIT} (${SECURITY_DEPOSIT_NOTE})`,
    },
    { item: '9', label: 'Utility Deposit', value: UTILITY_DEPOSIT },
    { item: '10', label: 'Access Card Deposit', value: ACCESS_CARD_DEPOSIT },
    { item: '11', label: 'Permitted Use', value: PERMITTED_USE },
    { item: '12', label: 'Option to Renew', value: RENEWAL_LABEL },
    {
      item: '13',
      label: 'Landlord\'s Bank',
      value: `${BANK_NAME}\nACCOUNT NAME: ${BANK_ACCOUNT_NAME}\nACCOUNT NO: ${BANK_ACCOUNT_NO}`,
    },
    {
      item: '14',
      label: 'The Landlord',
      value: f.landlordIc ? `${f.landlordName}\nNRIC No. ${f.landlordIc}` : f.landlordName,
    },
    {
      item: '15',
      label: 'The Tenant',
      value: f.tenantIc ? `${f.tenantName}\nNRIC No. ${f.tenantIc}` : f.tenantName,
    },
  ];
}
