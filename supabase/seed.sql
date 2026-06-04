-- Optional demo seed documents and chunks.
-- Replace these with real Lava training PDFs/Markdown uploads.

insert into public.employees (id, email, full_name, department, role)
values
  ('00000000-0000-0000-0000-000000000001', 'admin@lavatraining.com', 'Demo Admin', 'Training', 'Admin'),
  ('00000000-0000-0000-0000-000000000002', 'va@lavatraining.com', 'Demo VA', 'Personal Lines', 'VA')
on conflict (id) do nothing;

insert into public.role_grants (employee_id, role_key, department)
values
  ('00000000-0000-0000-0000-000000000001', 'Admin', 'Admin'),
  ('00000000-0000-0000-0000-000000000001', 'Trainer', 'Training')
on conflict do nothing;

insert into public.docs (id, title, description, file_path, file_type, department, status)
values
  ('11111111-1111-1111-1111-111111111111', 'Lava Insurance VA Onboarding Guide', 'Starter guide for VA insurance expectations.', 'seed/training/onboarding.md', 'markdown', 'Training', 'indexed'),
  ('22222222-2222-2222-2222-222222222222', 'Attendance and Timekeeping Policy', 'Attendance, timekeeping, and reporting process.', 'seed/operations/attendance.md', 'markdown', 'Operations', 'indexed'),
  ('33333333-3333-3333-3333-333333333333', 'Escalation Runbook', 'Escalation process for coverage, access, client, and urgent issues.', 'seed/customer-success/escalation.md', 'markdown', 'Customer Success', 'indexed'),
  ('44444444-4444-4444-4444-444444444444', 'Personal Lines Training SOP', 'Personal lines support rules and task boundaries.', 'seed/personal-lines/sop.md', 'markdown', 'Personal Lines', 'indexed'),
  ('55555555-5555-5555-5555-555555555555', 'Commercial Lines Training SOP', 'Commercial lines support rules and task boundaries.', 'seed/commercial-lines/sop.md', 'markdown', 'Commercial Lines', 'indexed')
on conflict (id) do nothing;

insert into public.doc_chunks (doc_id, chunk_text, chunk_index, department)
values
  ('11111111-1111-1111-1111-111111111111', 'Lava insurance VAs should follow the approved training workflow, document work clearly, and escalate questions that require licensed insurance judgment.', 0, 'Training'),
  ('22222222-2222-2222-2222-222222222222', 'Attendance concerns should be reported using the approved Lava process. VAs should notify the proper Trainer or Team Lead when they cannot report to work or need schedule support.', 0, 'Operations'),
  ('33333333-3333-3333-3333-333333333333', 'Coverage interpretation, legal advice, claims decisions, and binding authority questions must be escalated to a licensed producer, Account Manager, Trainer, or Team Lead based on the account process.', 0, 'Customer Success'),
  ('44444444-4444-4444-4444-444444444444', 'Personal Lines support may include data entry, renewal assistance, quoting support, documentation, and follow-up tasks. VAs should not confirm coverage or make licensed-agent decisions.', 0, 'Personal Lines'),
  ('55555555-5555-5555-5555-555555555555', 'Commercial Lines support may include certificates, renewals, data gathering, AMS updates, and document preparation. Coverage questions should be escalated to licensed staff.', 0, 'Commercial Lines')
on conflict do nothing;
