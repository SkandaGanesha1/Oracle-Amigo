CREATE INDEX IF NOT EXISTS idx_users_org_email ON users(org_id, email);
CREATE INDEX IF NOT EXISTS idx_users_org_id ON users(org_id, id);

CREATE INDEX IF NOT EXISTS idx_user_credentials_user ON user_credentials(user_id);

CREATE INDEX IF NOT EXISTS idx_refresh_tokens_user ON refresh_tokens(user_id);
CREATE INDEX IF NOT EXISTS idx_refresh_tokens_hash ON refresh_tokens(token_hash);
CREATE INDEX IF NOT EXISTS idx_refresh_tokens_org_user ON refresh_tokens(org_id, user_id);
CREATE INDEX IF NOT EXISTS idx_refresh_tokens_org_device ON refresh_tokens(org_id, device_id);

CREATE INDEX IF NOT EXISTS idx_devices_org_user ON devices(org_id, user_id);
CREATE INDEX IF NOT EXISTS idx_devices_org_status ON devices(org_id, status);

CREATE INDEX IF NOT EXISTS idx_device_tokens_device ON device_tokens(device_id);
CREATE INDEX IF NOT EXISTS idx_device_tokens_hash ON device_tokens(token_hash);
CREATE INDEX IF NOT EXISTS idx_device_tokens_org_user ON device_tokens(org_id, user_id);
CREATE INDEX IF NOT EXISTS idx_device_tokens_org_device ON device_tokens(org_id, device_id);

CREATE INDEX IF NOT EXISTS idx_agents_org_owner ON agents(org_id, owner_user_id);
CREATE INDEX IF NOT EXISTS idx_agents_org_status ON agents(org_id, status);

CREATE INDEX IF NOT EXISTS idx_agent_instances_org_instance ON agent_instances(org_id, id);
CREATE INDEX IF NOT EXISTS idx_agent_instances_org_agent ON agent_instances(org_id, agent_id, user_id, status);
CREATE INDEX IF NOT EXISTS idx_agent_instances_org_user ON agent_instances(org_id, user_id, status);
CREATE INDEX IF NOT EXISTS idx_agent_instances_org_device ON agent_instances(org_id, device_id, status);
CREATE INDEX IF NOT EXISTS idx_agent_instances_org_inbox ON agent_instances(org_id, relay_inbox_id);
CREATE INDEX IF NOT EXISTS idx_agent_instances_org_active ON agent_instances(org_id, user_id, last_seen_at) WHERE status = 'active';

CREATE INDEX IF NOT EXISTS idx_contacts_org_requester_status ON contacts(org_id, requester_user_id, status);
CREATE INDEX IF NOT EXISTS idx_contacts_org_target_status ON contacts(org_id, target_user_id, status);

CREATE INDEX IF NOT EXISTS idx_presence_org_status_heartbeat ON presence(org_id, status, last_heartbeat_at);
CREATE INDEX IF NOT EXISTS idx_presence_org_user ON presence(org_id, user_id);
CREATE INDEX IF NOT EXISTS idx_presence_org_online ON presence(org_id, last_heartbeat_at) WHERE status = 'online';

CREATE INDEX IF NOT EXISTS idx_relay_tasks_to_status ON relay_tasks(org_id, to_agent_instance_id, status);
CREATE INDEX IF NOT EXISTS idx_relay_tasks_from ON relay_tasks(org_id, from_agent_instance_id);
CREATE INDEX IF NOT EXISTS idx_relay_tasks_org_inbox_status ON relay_tasks(org_id, to_agent_instance_id, status, created_at);
CREATE INDEX IF NOT EXISTS idx_relay_tasks_org_queued ON relay_tasks(org_id, to_agent_instance_id, next_retry_at, created_at) WHERE status = 'queued';
CREATE INDEX IF NOT EXISTS idx_relay_tasks_org_retry ON relay_tasks(org_id, to_agent_instance_id, next_retry_at, attempt_count) WHERE status IN ('queued', 'delivered_to_remote_agent');
CREATE INDEX IF NOT EXISTS idx_relay_tasks_org_dead_letter ON relay_tasks(org_id, status, failed_at, created_at) WHERE status IN ('failed', 'expired');
CREATE INDEX IF NOT EXISTS idx_relay_tasks_org_expires ON relay_tasks(org_id, expires_at) WHERE status IN ('accepted', 'queued', 'delivered_to_remote_agent');

CREATE INDEX IF NOT EXISTS idx_relay_messages_to_status ON relay_messages(org_id, to_agent_instance_id, status);
CREATE INDEX IF NOT EXISTS idx_relay_messages_from ON relay_messages(org_id, from_agent_instance_id);
CREATE INDEX IF NOT EXISTS idx_relay_messages_org_inbox_status ON relay_messages(org_id, to_agent_instance_id, status, created_at);
CREATE INDEX IF NOT EXISTS idx_relay_messages_org_inbox_queued ON relay_messages(org_id, to_agent_instance_id, created_at) WHERE status = 'queued';
CREATE INDEX IF NOT EXISTS idx_relay_messages_org_inbox_retry ON relay_messages(org_id, to_agent_instance_id, delivered_at, created_at) WHERE status IN ('queued', 'delivered');

CREATE INDEX IF NOT EXISTS idx_file_transfers_to_status ON file_transfers(org_id, to_agent_instance_id, status);
CREATE INDEX IF NOT EXISTS idx_file_transfers_from_status ON file_transfers(org_id, from_agent_instance_id, status);
CREATE INDEX IF NOT EXISTS idx_file_transfers_org_status_created ON file_transfers(org_id, status, created_at);
CREATE INDEX IF NOT EXISTS idx_file_transfers_org_expires ON file_transfers(org_id, expires_at);
CREATE INDEX IF NOT EXISTS idx_file_transfers_org_active_status ON file_transfers(org_id, to_agent_instance_id, status, created_at) WHERE status IN ('ready', 'uploading', 'downloading');

CREATE INDEX IF NOT EXISTS idx_transfer_keys_transfer ON transfer_encryption_keys(transfer_id);
CREATE INDEX IF NOT EXISTS idx_transfer_keys_org_transfer ON transfer_encryption_keys(org_id, transfer_id);

CREATE INDEX IF NOT EXISTS idx_audit_events_org_created ON audit_events(org_id, created_at);
CREATE INDEX IF NOT EXISTS idx_audit_events_org_actor_user ON audit_events(org_id, actor_user_id, created_at);
CREATE INDEX IF NOT EXISTS idx_audit_events_org_actor_agent ON audit_events(org_id, actor_agent_instance_id, created_at);

CREATE INDEX IF NOT EXISTS idx_recovery_user ON admin_recovery_codes(admin_user_id);
CREATE INDEX IF NOT EXISTS idx_sessions_user ON admin_sessions(admin_user_id);
CREATE INDEX IF NOT EXISTS idx_sessions_expires ON admin_sessions(expires_at);
CREATE INDEX IF NOT EXISTS idx_attempts_email_time ON admin_login_attempts(email_lower, created_at);
CREATE INDEX IF NOT EXISTS idx_attempts_ip_time ON admin_login_attempts(ip_address, created_at);
CREATE INDEX IF NOT EXISTS idx_setup_challenges_expires ON admin_setup_challenges(expires_at);
CREATE INDEX IF NOT EXISTS idx_login_challenges_expires ON admin_login_challenges(expires_at);
CREATE INDEX IF NOT EXISTS idx_login_challenges_user ON admin_login_challenges(admin_user_id);
