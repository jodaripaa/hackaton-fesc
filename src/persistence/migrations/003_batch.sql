CREATE TABLE caja_link.batch_jobs (
    job_id uuid PRIMARY KEY,
    requesting_caja text NOT NULL CHECK (requesting_caja IN ('NORTE', 'ORIENTE', 'CENTRO', 'SUR')),
    purpose text NOT NULL CHECK (purpose IN ('TARIFA_SUBSIDIADA', 'SUBSIDIO_MONETARIO', 'VALIDACION_AFILIACION')),
    idempotency_key text NOT NULL CHECK (length(idempotency_key) BETWEEN 1 AND 200),
    content_hash text NOT NULL CHECK (content_hash ~ '^[0-9a-f]{64}$'),
    documents text[] NOT NULL CHECK (cardinality(documents) BETWEEN 1 AND 100000),
    status text NOT NULL DEFAULT 'PENDING' CHECK (status IN ('PENDING', 'RUNNING', 'DONE')),
    next_row integer NOT NULL DEFAULT 0 CHECK (next_row >= 0 AND next_row <= cardinality(documents)),
    lease_owner uuid,
    lease_until timestamptz,
    created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    UNIQUE (requesting_caja, idempotency_key),
    CHECK ((status = 'RUNNING' AND lease_owner IS NOT NULL AND lease_until IS NOT NULL)
        OR (status <> 'RUNNING' AND lease_owner IS NULL AND lease_until IS NULL)),
    CHECK (status <> 'DONE' OR next_row = cardinality(documents))
);
CREATE INDEX batch_jobs_pending ON caja_link.batch_jobs (created_at, job_id) WHERE status = 'PENDING';
CREATE INDEX batch_jobs_leases ON caja_link.batch_jobs (lease_until) WHERE status = 'RUNNING';

CREATE TABLE caja_link.batch_results (
    job_id uuid NOT NULL REFERENCES caja_link.batch_jobs (job_id) ON DELETE CASCADE,
    row_index integer NOT NULL CHECK (row_index >= 0),
    payload jsonb NOT NULL CHECK (jsonb_typeof(payload) = 'object'),
    PRIMARY KEY (job_id, row_index)
);
