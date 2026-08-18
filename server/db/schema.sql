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
  -- Guardado para o cliente cadastrado não redigitar a cada compra.
  doc           TEXT NOT NULL DEFAULT '',
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
  -- Só dígitos. Exigido pela processadora para emitir a cobrança; pedidos
  -- antigos, anteriores à integração, ficam com string vazia.
  customer_doc   TEXT NOT NULL DEFAULT '',

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
-- Colunas acrescentadas depois
--
-- `CREATE TABLE IF NOT EXISTS` não altera tabela que já existe, então colunas
-- novas precisam vir aqui para alcançar bancos criados antes desta versão.
-- -----------------------------------------------------------------------------

ALTER TABLE orders    ADD COLUMN IF NOT EXISTS customer_doc TEXT NOT NULL DEFAULT '';
ALTER TABLE customers ADD COLUMN IF NOT EXISTS doc          TEXT NOT NULL DEFAULT '';

-- Marca que o estoque deste pedido já voltou para a prateleira. Sem isto, um
-- pedido cancelado duas vezes (ou cancelado e depois estornado) devolveria o
-- estoque em dobro e a loja passaria a vender o que não tem.
ALTER TABLE orders ADD COLUMN IF NOT EXISTS stock_restored BOOLEAN NOT NULL DEFAULT false;

-- Peso e medidas do pacote. Nenhuma transportadora emite etiqueta sem isso.
-- Ficam com zero por padrão: produto sem medida continua vendendo normalmente,
-- só não pode gerar etiqueta.
ALTER TABLE products ADD COLUMN IF NOT EXISTS weight_g  INTEGER      NOT NULL DEFAULT 0;
ALTER TABLE products ADD COLUMN IF NOT EXISTS length_cm NUMERIC(6,1) NOT NULL DEFAULT 0;
ALTER TABLE products ADD COLUMN IF NOT EXISTS width_cm  NUMERIC(6,1) NOT NULL DEFAULT 0;
ALTER TABLE products ADD COLUMN IF NOT EXISTS height_cm NUMERIC(6,1) NOT NULL DEFAULT 0;

-- Nome do eixo de variação ("Cor", "Tamanho"). Vazio = produto sem variação,
-- que é o comportamento de sempre.
ALTER TABLE products ADD COLUMN IF NOT EXISTS variant_label TEXT NOT NULL DEFAULT '';

-- Grade de variação, no formato dos ERPs de marketplace:
--   [{ "name": "Cor", "options": ["Azul","Vermelho"] },
--    { "name": "Tamanho", "options": ["P","M","G"] }]
-- Cada cruzamento vira uma linha em product_variants com o seu próprio código,
-- preço e estoque. Substitui o variant_label, que só permitia um eixo.
ALTER TABLE products ADD COLUMN IF NOT EXISTS variant_axes JSONB NOT NULL DEFAULT '[]'::jsonb;

-- -----------------------------------------------------------------------------
-- Variações de produto
--
-- Um eixo só (cor OU tamanho), não uma matriz: no material escolar a variação
-- é sempre de uma dimensão, e a matriz cobraria um preço de complexidade que
-- ninguém aqui usaria. Cada opção tem preço e estoque próprios, porque
-- colorset azul e vermelho podem acabar em dias diferentes.
-- -----------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS product_variants (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  product_id UUID NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  name       TEXT NOT NULL,
  sku        TEXT NOT NULL DEFAULT '',
  price      NUMERIC(10,2) NOT NULL CHECK (price >= 0),
  promo      NUMERIC(10,2) NOT NULL DEFAULT 0 CHECK (promo >= 0),
  stock      INTEGER NOT NULL DEFAULT 0 CHECK (stock >= 0),
  active     BOOLEAN NOT NULL DEFAULT true,
  position   INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT product_variants_promo_below_price CHECK (promo = 0 OR promo < price)
);

CREATE INDEX IF NOT EXISTS product_variants_product
  ON product_variants (product_id, position);

-- Qual variação foi comprada. O nome é copiado junto porque o histórico do
-- pedido não pode mudar se a variação for renomeada ou excluída depois.
ALTER TABLE order_items ADD COLUMN IF NOT EXISTS variant_id
  UUID REFERENCES product_variants(id) ON DELETE SET NULL;
ALTER TABLE order_items ADD COLUMN IF NOT EXISTS variant_name TEXT NOT NULL DEFAULT '';

-- Qual ponto da grade esta variação ocupa: {"Cor":"Azul","Tamanho":"P"}.
-- O `name` continua existindo como rótulo pronto ("Azul / P"), para não
-- remontar a string em toda tela.
ALTER TABLE product_variants ADD COLUMN IF NOT EXISTS options JSONB NOT NULL DEFAULT '{}'::jsonb;

-- Código de barras por variação, como os ERPs de marketplace exigem.
ALTER TABLE product_variants ADD COLUMN IF NOT EXISTS gtin TEXT NOT NULL DEFAULT '';

-- Converte o eixo único antigo para a grade. Roda uma vez: depois da conversão
-- o variant_label fica vazio e as condições param de casar.
UPDATE products
   SET variant_axes = jsonb_build_array(
         jsonb_build_object(
           'name', variant_label,
           'options', COALESCE(
             (SELECT jsonb_agg(v.name ORDER BY v.position, v.name)
                FROM product_variants v WHERE v.product_id = products.id),
             '[]'::jsonb)))
 WHERE variant_label <> '' AND variant_axes = '[]'::jsonb;

UPDATE product_variants v
   SET options = jsonb_build_object(p.variant_label, v.name)
  FROM products p
 WHERE v.product_id = p.id AND p.variant_label <> '' AND v.options = '{}'::jsonb;

UPDATE products SET variant_label = '' WHERE variant_label <> '';

-- Dois pontos iguais da grade seriam dois estoques para a mesma coisa. O
-- jsonb normaliza a ordem das chaves, então {"Cor":"Azul","Tam":"P"} e
-- {"Tam":"P","Cor":"Azul"} colidem como devem.
CREATE UNIQUE INDEX IF NOT EXISTS product_variants_combinacao
  ON product_variants (product_id, options)
  WHERE options <> '{}'::jsonb;

-- -----------------------------------------------------------------------------
-- Endereço do remetente
--
-- `settings.address` é texto livre e serve para mostrar no rodapé. A etiqueta
-- exige os campos separados, com CEP em dígitos — por isso a duplicação.
-- -----------------------------------------------------------------------------

ALTER TABLE settings ADD COLUMN IF NOT EXISTS sender_name    TEXT NOT NULL DEFAULT '';
ALTER TABLE settings ADD COLUMN IF NOT EXISTS sender_doc     TEXT NOT NULL DEFAULT '';
ALTER TABLE settings ADD COLUMN IF NOT EXISTS sender_cep     TEXT NOT NULL DEFAULT '';
ALTER TABLE settings ADD COLUMN IF NOT EXISTS sender_street  TEXT NOT NULL DEFAULT '';
ALTER TABLE settings ADD COLUMN IF NOT EXISTS sender_number  TEXT NOT NULL DEFAULT '';
ALTER TABLE settings ADD COLUMN IF NOT EXISTS sender_compl   TEXT NOT NULL DEFAULT '';
ALTER TABLE settings ADD COLUMN IF NOT EXISTS sender_district TEXT NOT NULL DEFAULT '';
ALTER TABLE settings ADD COLUMN IF NOT EXISTS sender_city    TEXT NOT NULL DEFAULT '';
ALTER TABLE settings ADD COLUMN IF NOT EXISTS sender_state   TEXT NOT NULL DEFAULT '';

-- Token da transportadora no banco, não em variável de ambiente.
--
-- Motivo prático: no Railway, mudar uma variável exige um deploy, e deploy
-- falha (o GitHub caiu no meio de um). Enquanto isso, a loja fica rodando com
-- a credencial velha e nada que se ajuste no painel tem efeito.
--
-- Aqui o dono cola o token na tela e ele passa a valer na hora. Também resolve
-- a troca a cada 30 dias, que é a validade do token deles.
--
-- Vazio = usa a variável de ambiente, para não quebrar quem já configurou lá.
ALTER TABLE settings ADD COLUMN IF NOT EXISTS melhorenvio_token TEXT NOT NULL DEFAULT '';

-- Comprar a etiqueta sozinho assim que o pagamento é confirmado.
--
-- Fica desligável porque a compra gasta saldo real da carteira: quem preferir
-- conferir cada pedido antes de despachar consegue voltar ao fluxo manual.
ALTER TABLE settings ADD COLUMN IF NOT EXISTS auto_label BOOLEAN NOT NULL DEFAULT true;

-- Qual serviço o cliente escolheu no checkout.
--
-- `delivery_zone` guarda o nome para leitura ("Correios SEDEX"); a compra da
-- etiqueta precisa do id, e nome não serve para reencontrar o serviço na
-- cotação seguinte.
ALTER TABLE orders ADD COLUMN IF NOT EXISTS shipping_service_id TEXT NOT NULL DEFAULT '';

-- -----------------------------------------------------------------------------
-- Envios
--
-- Uma linha por etiqueta. Sem esta tabela, uma falha no meio do processo de
-- compra faria a loja gerar etiqueta duplicada — e etiqueta duplicada é
-- cobrança duplicada da transportadora.
--
-- O ciclo do Melhor Envio tem quatro passos (carrinho, checkout/pagamento,
-- geração, impressão), e a etiqueta pode ficar parada em qualquer um deles.
-- Por isso o status é próprio, e não um espelho do que a transportadora diz.
-- -----------------------------------------------------------------------------

DO $$ BEGIN
  CREATE TYPE shipment_status AS ENUM (
    'rascunho',    -- no carrinho da transportadora, ainda não pago
    'pago',        -- comprado, aguardando geração
    'gerada',      -- etiqueta emitida, pronta para imprimir
    'postado',     -- despachado, em trânsito
    'entregue',
    'cancelado',
    'erro'
  );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE TABLE IF NOT EXISTS shipments (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id      UUID NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  provider      TEXT NOT NULL,
  -- Id da etiqueta no lado da transportadora. Único por provedor para o
  -- webhook conseguir achar a linha sem ambiguidade.
  external_id   TEXT NOT NULL DEFAULT '',
  status        shipment_status NOT NULL DEFAULT 'rascunho',
  service_name  TEXT NOT NULL DEFAULT '',
  carrier       TEXT NOT NULL DEFAULT '',
  tracking      TEXT NOT NULL DEFAULT '',
  label_url     TEXT NOT NULL DEFAULT '',
  cost          NUMERIC(10,2) NOT NULL DEFAULT 0 CHECK (cost >= 0),
  -- Resposta crua da transportadora, para conferência quando algo diverge.
  raw           JSONB NOT NULL DEFAULT '{}'::jsonb,
  error         TEXT NOT NULL DEFAULT '',
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS shipments_order ON shipments (order_id, created_at DESC);

-- A busca do webhook é por (provedor, id externo); o índice único também
-- impede duas etiquetas apontando para a mesma na transportadora.
CREATE UNIQUE INDEX IF NOT EXISTS shipments_externo
  ON shipments (provider, external_id)
  WHERE external_id <> '';

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

-- -----------------------------------------------------------------------------
-- E-mail
--
-- A chave fica no banco pelo mesmo motivo da transportadora: trocar variável de
-- ambiente exige deploy, e deploy falha. Vazio = usa a variável de ambiente.
-- -----------------------------------------------------------------------------

ALTER TABLE settings ADD COLUMN IF NOT EXISTS email_key TEXT NOT NULL DEFAULT '';

-- Para onde vai o aviso de venda nova. Vazio = usa o e-mail de contato da loja.
ALTER TABLE settings ADD COLUMN IF NOT EXISTS notify_email TEXT NOT NULL DEFAULT '';

-- Avisar o cliente por e-mail em cada etapa. Desligável para quem preferir
-- falar por outro canal.
ALTER TABLE settings ADD COLUMN IF NOT EXISTS notify_customer BOOLEAN NOT NULL DEFAULT true;

-- Registro do que já foi enviado.
--
-- Existe para não mandar o mesmo aviso duas vezes: o webhook da processadora
-- reenvia eventos, e receber "seu pedido foi enviado" três vezes é ruído que
-- corrói a confiança de quem comprou.
CREATE TABLE IF NOT EXISTS email_log (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id   UUID REFERENCES orders(id) ON DELETE CASCADE,
  tipo       TEXT NOT NULL,
  destino    TEXT NOT NULL,
  status     TEXT NOT NULL DEFAULT 'enviado',
  erro       TEXT NOT NULL DEFAULT '',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Um aviso de cada tipo por pedido. É a trava contra o reenvio.
--
-- Cobre 'enviando' também, e não só 'enviado': a reserva precisa colidir no
-- INSERT, antes de a mensagem sair. Cobrindo só o estado final, a segunda
-- tentativa inseria, mandava o e-mail e só então falhava — tarde demais.
-- 'falhou' fica de fora para uma tentativa futura ser possível.
DROP INDEX IF EXISTS email_log_unico;
CREATE UNIQUE INDEX IF NOT EXISTS email_log_unico
  ON email_log (order_id, tipo)
  WHERE order_id IS NOT NULL AND status <> 'falhou';
