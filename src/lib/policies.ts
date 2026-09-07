/**
 * Mahadev Constructions' internal FleetView policy source.
 *
 * This is intentionally application-owned content rather than a marketing
 * "terms" page: every item below maps to a record or workflow FleetView
 * actually handles. Legal/HR owns the company-specific decisions listed in
 * `POLICY_ISSUANCE_REQUIREMENTS` before the policy is formally issued.
 */
export const POLICY_VERSION = "1.0";

export const POLICY_ISSUANCE_REQUIREMENTS = [
  "Name the Mahadev HR/privacy contact and grievance route.",
  "Approve retention schedules for employment, contractor, safety, fuel, vehicle, and tax records.",
  "Confirm the Pitbull–Mahadev service agreement, data-processing roles, and authorised support access.",
  "Issue the approved notice to employees and contractors in the languages needed at each site.",
] as const;

export type PolicySection = {
  id: string;
  title: string;
  summary: string;
  points: readonly string[];
};

export const POLICY_SECTIONS: readonly PolicySection[] = [
  {
    id: "scope",
    title: "1. Scope and who this applies to",
    summary: "This is the internal operating policy for authorised FleetView users at Mahadev Constructions.",
    points: [
      "It applies to Mahadev employees, drivers, site staff, managers, and contractors who are given a FleetView login or submit records through the app.",
      "Use FleetView only for Mahadev work. Employment, contractor, safety, and project terms continue to apply alongside this policy.",
      "Mahadev management owns operational decisions. Pitbull Corporations provides and supports the FleetView platform under the applicable service agreement.",
    ],
  },
  {
    id: "privacy",
    title: "2. Privacy and personal information",
    summary: "FleetView uses only the information needed to run, secure, and improve Mahadev's fleet and site operations.",
    points: [
      "Records may include your name, work contact details, role, login activity, licence and identity documents you submit, driver assignment, attendance or duty status, and training or compliance records.",
      "For an assigned vehicle, records may include location/GPS, trip and meter readings, engine or fuel telemetry, fuel-entry photos, incident photos or voice notes, and safety or maintenance reports.",
      "Mahadev must give a clear notice before collecting information and identify the purpose, contact route, and any consent or other lawful basis required for that collection.",
      "Do not upload another person's identity document, phone number, photo, or voice recording unless it is necessary for the report and you are authorised to do so.",
    ],
  },
  {
    id: "monitoring",
    title: "3. Vehicle, fuel, and safety monitoring",
    summary: "Operational monitoring exists to protect people, vehicles, fuel, and project records — not for personal use.",
    points: [
      "When you use an assigned vehicle or the driver app, Mahadev may review trip status, location, vehicle telemetry, fuel level changes, fuel evidence, vehicle condition, and reported events.",
      "A sudden fuel change, unsafe condition, missing evidence, or inconsistent meter record can be flagged for a human review. A flag is a check, not a finding of wrongdoing by itself.",
      "In an accident or emergency, protect people first: use emergency services and follow Mahadev site procedures. Submit the FleetView report as soon as it is safe to do so.",
    ],
  },
  {
    id: "acceptable-use",
    title: "4. Acceptable use and record accuracy",
    summary: "Every person is responsible for protecting their login and entering honest work records.",
    points: [
      "Keep your password, QR access, and logged-in device private. Do not share a login or record work, fuel, or a trip for someone else.",
      "Enter readings, quantities, costs, photos, and reports truthfully. Do not alter, delete, fabricate, or hide an operational record.",
      "Use the Report flow for faults, roadblocks, accidents, leaks, fuel concerns, or other hindrances. Never use FleetView to harass, discriminate against, or profile a person.",
      "Do not upload malware, inappropriate content, customer data, or documents unrelated to Mahadev work.",
    ],
  },
  {
    id: "access",
    title: "5. Access, sharing, and security",
    summary: "Access is role-based and limited to the work a person is authorised to perform.",
    points: [
      "Mahadev authorised managers and administrators may view records needed for fleet operations, payroll or contractor administration, safety, compliance, investigations, finance, and legal obligations.",
      "Pitbull support may access the minimum information necessary to investigate a reported platform issue, subject to the service agreement and authorised support procedures.",
      "Information may be shared with a lawful authority, insurer, emergency responder, auditor, or service provider only when needed and authorised by Mahadev or required by law.",
      "Report a lost device, suspected shared password, unexpected account access, or wrong data access to your supervisor immediately.",
    ],
  },
  {
    id: "retention",
    title: "6. Retention, correction, and deletion",
    summary: "Mahadev keeps records only for its defined operational, contractual, safety, financial, and legal needs.",
    points: [
      "Exact retention periods must be set in Mahadev's approved retention schedule; this screen does not invent or override them.",
      "A record may be retained where needed for a live job, warranty, accident investigation, audit, tax or accounting record, dispute, legal hold, or legal obligation.",
      "If you believe your personal or work information is wrong, contact your supervisor or the Mahadev HR/privacy contact so it can be reviewed and corrected where appropriate.",
      "When a retention period ends and no lawful need remains, Mahadev should securely delete or anonymise the information under its approved process.",
    ],
  },
  {
    id: "rights",
    title: "7. Questions, complaints, and policy changes",
    summary: "Mahadev must provide a real contact route before this policy is formally issued.",
    points: [
      "For immediate site, vehicle, or safety help, contact your supervisor or use the emergency and Report options in the driver app.",
      "For a privacy question, correction request, complaint, or concern about data use, contact Mahadev's named HR/privacy contact or grievance route in the issued notice.",
      "Mahadev will communicate material policy changes before applying them where required. Continued authorised use does not remove any right available under applicable law.",
      "This page is an internal operating notice, not a substitute for Mahadev's approved employment, contractor, privacy, security, or emergency procedures.",
    ],
  },
] as const;

export const DRIVER_POLICY_SUMMARY = {
  en: [
    "FleetView records your assigned vehicle, trips, fuel and safety reports for Mahadev work.",
    "Keep your login private. Enter true readings and never make a record for someone else.",
    "GPS, fuel changes and safety reports may be reviewed. A system flag means someone will check it; it is not a decision by itself.",
    "For an accident, help people and call emergency services first. Report in the app when safe.",
    "Ask your supervisor or Mahadev HR if you need to correct your information or have a privacy concern.",
  ],
  hi: [
    "FleetView में आपकी गाड़ी, ट्रिप, डीज़ल और सुरक्षा रिपोर्ट सिर्फ़ महादेव के काम के लिए दर्ज होते हैं।",
    "अपना लॉगिन निजी रखें। सही रीडिंग भरें और किसी दूसरे के लिए रिकॉर्ड न बनाएं।",
    "GPS, डीज़ल में बदलाव और सुरक्षा रिपोर्ट देखी जा सकती हैं। सिस्टम का फ्लैग सिर्फ़ जाँच है, फैसला नहीं।",
    "दुर्घटना में पहले लोगों की मदद करें और आपात सेवा को कॉल करें। सुरक्षित होने पर ऐप में रिपोर्ट करें।",
    "जानकारी ठीक करवानी हो या प्राइवेसी की चिंता हो तो सुपरवाइज़र या महादेव HR से बात करें।",
  ],
} as const;
