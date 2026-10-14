CREATE TABLE caja_link.audit (
    id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    request_id uuid NOT NULL UNIQUE,
    occurred_at timestamptz NOT NULL,
    requesting_caja text NOT NULL CHECK (requesting_caja IN ('NORTE', 'ORIENTE', 'CENTRO', 'SUR')),
    purpose text NOT NULL CHECK (purpose IN ('TARIFA_SUBSIDIADA', 'SUBSIDIO_MONETARIO', 'VALIDACION_AFILIACION')),
    result text NOT NULL CHECK (result IN ('AFILIADO_OTRA_CAJA', 'NO_AFILIADO', 'INDETERMINADO')),
    document_masked text NOT NULL CHECK (document_masked ~ '^\*+[0-9]{0,4}$')
);
CREATE INDEX audit_recent ON caja_link.audit (occurred_at DESC, id DESC);
