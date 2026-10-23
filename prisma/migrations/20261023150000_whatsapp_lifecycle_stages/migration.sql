-- Replace the lead stages with the respond.io lifecycle list. Chats lose their old stage.
UPDATE "whatsapp_conversations" SET "stage_id" = NULL, "stage_by" = NULL WHERE "stage_id" IS NOT NULL;
DELETE FROM "whatsapp_labels" WHERE "kind" = 'stage';

INSERT INTO "whatsapp_labels" ("id", "kind", "name", "description", "color", "sort") VALUES
  ('stage_new_lead', 'stage', '🆕 New Lead', 'First contact or early questions; no plan chosen yet.', 'gray', 0),
  ('stage_plan_selected', 'stage', '⬆️ Plan Selected', 'The customer has picked a plan/package.', 'blue', 1),
  ('stage_docs_pending', 'stage', '⏸️ Supporting Documents Pending', 'Plan chosen; we are waiting for IC, address or other documents.', 'amber', 2),
  ('stage_docs_received', 'stage', '📝 Supporting Documents Received', 'The customer has sent the IC / documents.', 'violet', 3),
  ('stage_closing_script', 'stage', '👤 Closing Script Agreed', 'The customer agreed to the closing script / order details.', 'violet', 4),
  ('stage_pending_install', 'stage', '⛑️ Pending Installation', 'Order placed; waiting for the installation appointment.', 'amber', 5),
  ('stage_pending_demand', 'stage', '💡 Pending Demand', 'No coverage at the address yet; waiting for demand / port availability.', 'amber', 6),
  ('stage_pending_transfer', 'stage', '📝 Pending Transfer Ownership', 'Waiting on an ownership / line transfer.', 'amber', 7),
  ('stage_install_done_a', 'stage', '🤚 Installation Done - Pending Claim', 'Installed; follow-up or claim still pending.', 'green', 8),
  ('stage_install_done_b', 'stage', '🎁 Installation Done - Gift Sent', 'Installed and the gift / reward has been sent.', 'green', 9),
  ('stage_follow_up', 'stage', '🔃 Follow Up', 'Went quiet or asked to be contacted later; needs a follow-up.', 'blue', 10),
  ('stage_other_inquiry', 'stage', '😒 Other Inquiry', 'Not a sign-up: unrelated question, support, wrong number, spam.', 'gray', 11),
  ('stage_bypass_request', 'stage', '💡 Bypass Request', 'Asks to bypass a check or restriction.', 'amber', 12),
  ('stage_cold_lead', 'stage', '🔄 Cold Lead - Old', 'Old lead that stopped replying.', 'gray', 13),
  ('stage_ic_blacklisted', 'stage', '🚫 IC Blacklisted', 'The customer''s IC is blacklisted by the portal.', 'red', 14),
  ('stage_existing_wifi', 'stage', '😑 Existing WiFi User', 'Already has Unifi / TM at the address.', 'gray', 15),
  ('stage_pending_hq_termination', 'stage', '🏢 Pending HQ Termination', 'Waiting for HQ to terminate an existing line.', 'amber', 16),
  ('stage_pending_device_stock', 'stage', '🧭 Pending Device Stock', 'Waiting for the chosen device to be back in stock.', 'amber', 17),
  ('stage_install_done', 'stage', '🤑 Installation Done', 'Installation is done or confirmed.', 'green', 18);
