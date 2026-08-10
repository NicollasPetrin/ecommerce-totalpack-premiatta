-- =============================================================================
-- TotalPack — esquema PostgreSQL
--
-- Roda inteiro a cada `npm run db:migrate`; tudo é idempotente (IF NOT EXISTS),
-- então reexecutar não destrói dados. Para zerar de verdade: npm run db:reset.
-- =============================================================================

CREATE EXTENSION IF NOT EXISTS pgcrypto;   -- gen_random_uuid()
CREATE EXTENSION IF NOT EXISTS unaccent;   -- busca sem acento

-- -----------------------------------------------------------------------------
-- Contas administrativas
-- -----------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS admins (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email         TEXT NOT NULL UNIQUE,
  name          TEXT NOT NULL,
  password_hash TEXT NOT NULL,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- -----------------------------------------------------------------------------
-- Clientes e endereços
-- -----------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS customers (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name          TEXT NOT NULL,
  email         TEXT NOT NULL UNIQUE,
  phone         TEXT NOT NULL DEFAULT '',
  password_hash TEXT NOT NULL,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- E-mail é a chave de login: comparação sempre em minúsculas.
CREATE UNIQUE INDEX IF NOT EXISTS customers_email_lower_idx
  ON customers (lower(email));

CREATE TABLE IF NOT EXISTS addresses (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  customer_id UUID NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
  label       TEXT NOT NULL DEFAULT 'Endereço',
  cep         TEXT NOT NULL,
  street      TEXT NOT NULL,
  number      TEXT NOT NULL,
  complement  TEXT NOT NULL DEFAULT '',
  district    TEXT NOT NULL,
  city        TEXT NOT NULL,
  state       CHAR(2) NOT NULL,
  is_default  BOOLEAN NOT NULL DEFAULT false,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS addresses_customer_idx ON addresses (customer_id);

-- No máximo um endereço padrão por cliente — garantido pelo banco, não pelo app.
CREATE UNIQUE INDEX IF NOT EXISTS addresses_one_default_idx
  ON addresses (customer_id) WHERE is_default;

-- -----------------------------------------------------------------------------
-- Catálogo
-- -----------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS categories (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name        TEXT NOT NULL,
  slug        TEXT NOT NULL UNIQUE,
  description TEXT NOT NULL DEFAULT '',
  position    INTEGER NOT NULL DEFAULT 99,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS products (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  category_id UUID REFERENCES categories(id) ON DELETE SET NULL,
  name        TEXT NOT NULL,
  sku         TEXT NOT NULL DEFAULT '',
  description TEXT NOT NULL DEFAULT '',
  -- Dinheiro em NUMERIC(10,2): float perde centavo em soma.
  price       NUMERIC(10,2) NOT NULL CHECK (price >= 0),
  promo       NUMERIC(10,2) NOT NULL DEFAULT 0 CHECK (promo >= 0),
  stock       INTEGER NOT NULL DEFAULT 0 CHECK (stock >= 0),
  unit        TEXT NOT NULL DEFAULT 'unidade',
  art         TEXT NOT NULL DEFAULT 'sheet',
  tint        TEXT NOT NULL DEFAULT '#0071e3',
  image       TEXT,
  specs       JSONB NOT NULL DEFAULT '[]'::jsonb,
  featured    BOOLEAN NOT NULL DEFAULT false,
  active      BOOLEAN NOT NULL DEFAULT true,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  -- Promoção só existe se for menor que o preço cheio.
  CONSTRAINT products_promo_below_price CHECK (promo = 0 OR promo < price)
);

CREATE INDEX IF NOT EXISTS products_category_idx ON products (category_id);
CREATE INDEX IF NOT EXISTS products_active_idx ON products (active) WHERE active;

-- Sem índice de busca textual: a loja carrega o catálogo inteiro e filtra no
-- navegador, o que dá conta de algumas centenas de produtos. Quando o catálogo
-- crescer e a busca virar consulta ao servidor, o índice entra aqui — lembrando
-- que `unaccent` é STABLE e precisa de um wrapper IMMUTABLE para ser indexável.

-- -----------------------------------------------------------------------------
-- Frete por faixa de CEP
-- -----------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS shipping_zones (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name       TEXT NOT NULL,
  -- CEP como texto de 8 dígitos: preserva zeros à esquerda.
  cep_start  CHAR(8) NOT NULL,
  cep_end    CHAR(8) NOT NULL,
  fee        NUMERIC(10,2) NOT NULL CHECK (fee >= 0),
  days       INTEGER NOT NULL CHECK (days >= 1),
  active     BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT shipping_zones_range CHECK (cep_start <= cep_end)
);

CREATE INDEX IF NOT EXISTS shipping_zones_range_idx ON shipping_zones (cep_start, cep_end);

-- -----------------------------------------------------------------------------
-- Pedidos
-- -----------------------------------------------------------------------------

DO $$ BEGIN
  CREATE TYPE order_status AS ENUM ('pendente', 'pago', 'enviado', 'entregue', 'cancelado');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- 'retirada' permanece no tipo por causa dos pedidos antigos; a loja deixou de
-- oferecer a opção, e o servidor só aceita 'entrega' em pedidos novos.
DO $$ BEGIN
  CREATE TYPE delivery_mode AS ENUM ('entrega', 'retirada');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

CREATE TABLE IF NOT EXISTS orders (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  -- Número sequencial visível ao cliente (#2026-0001).
  seq            INTEGER GENERATED BY DEFAULT AS IDENTITY,
  -- Pedido sem cadastro é permitido: customer_id fica nulo.
  customer_id    UUID REFERENCES customers(id) ON DELETE SET NULL,
  status         order_status NOT NULL DEFAULT 'pendente',

  customer_name  TEXT NOT NULL,
  customer_email TEXT NOT NULL DEFAULT '',
  customer_phone TEXT NOT NULL,

  delivery       delivery_mode NOT NULL DEFAULT 'entrega',
  delivery_zone  TEXT NOT NULL DEFAULT '',
  delivery_days  INTEGER NOT NULL DEFAULT 0,

  cep            TEXT NOT NULL DEFAULT '',
  street         TEXT NOT NULL DEFAULT '',
  number         TEXT NOT NULL DEFAULT '',
  complement     TEXT NOT NULL DEFAULT '',
  district       TEXT NOT NULL DEFAULT '',
  city           TEXT NOT NULL DEFAULT '',
  state          TEXT NOT NULL DEFAULT '',

  payment        TEXT NOT NULL DEFAULT 'pix',
  note           TEXT NOT NULL DEFAULT '',

  subtotal       NUMERIC(10,2) NOT NULL,
  shipping       NUMERIC(10,2) NOT NULL DEFAULT 0,
  total          NUMERIC(10,2) NOT NULL,

  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS orders_customer_idx ON orders (customer_id);
CREATE INDEX IF NOT EXISTS orders_created_idx ON orders (created_at DESC);
CREATE INDEX IF NOT EXISTS orders_status_idx ON orders (status);

-- -----------------------------------------------------------------------------
-- Pagamentos
--
-- Uma linha por tentativa de cobrança. Fica separada de `orders` porque uma
-- cobrança pode ser refeita (boleto vencido, cartão recusado) sem que o pedido
-- deixe de ser o mesmo, e porque o histórico de tentativas importa numa
-- eventual contestação.
--
-- Nada aqui guarda dado de cartão: só o identificador que a processadora
-- devolve e o endereço para onde o cliente foi pagar.
-- -----------------------------------------------------------------------------

DO $$ BEGIN
  CREATE TYPE payment_status AS ENUM (
    'pendente',    -- cobrança criada, aguardando o cliente
    'processando', -- processadora confirmou recebimento, ainda compensando
    'pago',
    'falhou',
    'estornado',
    'expirado'
  );
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

CREATE TABLE IF NOT EXISTS payments (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id     UUID NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  -- 'manual' enquanto não houver processadora; depois 'mercadopago', 'asaas'…
  provider     TEXT NOT NULL,
  -- Identificador da cobrança no lado da processadora.
  provider_ref TEXT,
  method       TEXT NOT NULL,
  status       payment_status NOT NULL DEFAULT 'pendente',
  amount       NUMERIC(10,2) NOT NULL CHECK (amount >= 0),
  -- Para onde mandar o cliente pagar (checkout hospedado ou boleto).
  checkout_url TEXT,
  -- Copia crua da resposta da processadora, útil para depurar divergências.
  raw          JSONB NOT NULL DEFAULT '{}'::jsonb,
  paid_at      TIMESTAMPTZ,
  expires_at   TIMESTAMPTZ,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS payments_order_idx ON payments (order_id);
CREATE INDEX IF NOT EXISTS payments_status_idx ON payments (status);

-- A processadora manda o mesmo evento mais de uma vez quando não recebe 200 na
-- primeira. Sem esta chave única, um pagamento seria contabilizado em dobro.
CREATE UNIQUE INDEX IF NOT EXISTS payments_provider_ref_idx
  ON payments (provider, provider_ref) WHERE provider_ref IS NOT NULL;

-- -----------------------------------------------------------------------------
-- Eventos de webhook
--
-- Toda notificação recebida é registrada antes de ser processada. Serve para
-- dois fins: garantir que o mesmo evento não seja aplicado duas vezes, e deixar
-- rastro do que a processadora enviou quando algo não bater.
-- -----------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS webhook_events (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  provider     TEXT NOT NULL,
  event_id     TEXT NOT NULL,
  event_type   TEXT NOT NULL DEFAULT '',
  payload      JSONB NOT NULL DEFAULT '{}'::jsonb,
  processed_at TIMESTAMPTZ,
  error        TEXT,
  received_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS webhook_events_unique_idx
  ON webhook_events (provider, event_id);

CREATE TABLE IF NOT EXISTS order_items (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id   UUID NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  -- Produto pode ser excluído do catálogo; o item do pedido permanece.
  product_id UUID REFERENCES products(id) ON DELETE SET NULL,
  -- Nome e preço são copiados: o histórico não pode mudar se o catálogo mudar.
  name       TEXT NOT NULL,
  sku        TEXT NOT NULL DEFAULT '',
  art        TEXT NOT NULL DEFAULT 'sheet',
  tint       TEXT NOT NULL DEFAULT '#0071e3',
  price      NUMERIC(10,2) NOT NULL,
  qty        INTEGER NOT NULL CHECK (qty > 0)
);

CREATE INDEX IF NOT EXISTS order_items_order_idx ON order_items (order_id);

-- -----------------------------------------------------------------------------
-- Configurações da loja (uma linha só)
-- -----------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS settings (
  id                  BOOLEAN PRIMARY KEY DEFAULT true CHECK (id),
  store_name          TEXT NOT NULL DEFAULT 'TotalPack',
  tagline             TEXT NOT NULL DEFAULT '',
  email               TEXT NOT NULL DEFAULT '',
  phone               TEXT NOT NULL DEFAULT '',
  address             TEXT NOT NULL DEFAULT '',
  hours               TEXT NOT NULL DEFAULT '',
  instagram           TEXT NOT NULL DEFAULT '',
  pix_key             TEXT NOT NULL DEFAULT '',
  free_shipping_from  NUMERIC(10,2) NOT NULL DEFAULT 199,
  -- Sem uso desde que a retirada saiu da loja; mantida para não quebrar
  -- bancos já existentes.
  pickup_enabled      BOOLEAN NOT NULL DEFAULT true,
  low_stock_threshold INTEGER NOT NULL DEFAULT 20,
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- -----------------------------------------------------------------------------
-- updated_at automático
-- -----------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION touch_updated_at() RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DO $$
DECLARE t TEXT;
BEGIN
  FOREACH t IN ARRAY ARRAY['customers', 'products', 'orders', 'settings', 'payments'] LOOP
    EXECUTE format('DROP TRIGGER IF EXISTS %I_touch ON %I', t, t);
    EXECUTE format(
      'CREATE TRIGGER %I_touch BEFORE UPDATE ON %I
       FOR EACH ROW EXECUTE FUNCTION touch_updated_at()', t, t);
  END LOOP;
END $$;
