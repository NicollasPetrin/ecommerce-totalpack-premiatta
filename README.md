# TotalPack

Loja de material escolar (papel A4, colorset, cadernos, arte) com painel
administrativo. React + Vite no front, API Express e PostgreSQL no back.

## Rodar

Precisa de **Node 18+** e **PostgreSQL 14+**.

```bash
npm install
```

Crie o banco e o usuário:

```bash
psql -U postgres -c "CREATE ROLE totalpack LOGIN PASSWORD 'troque_esta_senha'; CREATE DATABASE totalpack OWNER totalpack;"
```

Copie `.env.example` para `.env` e ajuste `DATABASE_URL` e `JWT_SECRET`. Depois:

```bash
npm run db:setup
```

Isso aplica o esquema e carrega o catálogo inicial. Por fim:

```bash
npm run dev
```

Sobe a API na porta 3333 e o front na 5173, juntos. Abra
`http://localhost:5173`.

### Outros comandos

| Comando | O que faz |
| --- | --- |
| `npm run dev:api` | Só a API, com recarga automática |
| `npm run dev:web` | Só o front |
| `npm run db:migrate` | Aplica o esquema (idempotente) |
| `npm run db:seed` | Carrega o catálogo inicial |
| `npm run db:reset` | **Apaga tudo** e recria o esquema vazio |
| `npm run build` | Gera o front em `dist/` |
| `npm start` | Roda a API em produção |

## Acesso

As credenciais iniciais saem do `npm run db:seed` e são definidas no `.env`:

- **Painel** (`/admin`): `admin@totalpack.com.br` / `admin12345`
- **Cliente de teste** (`/entrar`): `ana.moura@email.com` / `cliente12345`

**Troque as duas antes de qualquer uso real.**

## Arquitetura

```
server/
  index.js              Express: middlewares, rotas, encerramento limpo
  config.js             variáveis de ambiente, com validação
  db/schema.sql         esquema completo (tabelas, índices, constraints)
  db/pool.js            pool de conexões, helpers e transações
  db/migrate.js         aplica o esquema
  db/seed.js            carrega o catálogo inicial
  db/reset.js           zera o banco (só desenvolvimento)
  lib/auth.js           bcrypt, JWT em cookie httpOnly, guards de rota
  lib/shipping.js       frete por faixa de CEP (autoridade do servidor)
  lib/validate.js       schemas Zod de toda entrada
  lib/serialize.js      tradução snake_case (banco) → camelCase (front)
  lib/http.js           erros com status e middleware de erro
  routes/auth.js        contas de clientes, sessão, endereços
  routes/catalog.js     categorias e produtos
  routes/orders.js      criação de pedido, histórico, gestão
  routes/store.js       configurações, frete, acesso e clientes (admin)

src/
  lib/api.js            cliente HTTP
  store/StoreContext.jsx estado global; carga inicial e mutações via API
  pages/                Home, Catalog, Product, Checkout, OrderSuccess,
                        Auth (entrar/criar conta), Account (minha conta)
  pages/admin/          Dashboard, Products, Categories, Orders, Customers,
                        Shipping, Settings
  styles/               tokens.css (design), app.css (loja), admin.css (painel)
```

O front chama sempre `/api/...` na própria origem: no desenvolvimento o Vite
encaminha para o Express (ver `vite.config.js`), e em produção os dois são
servidos juntos.

## O que o servidor garante

Estas regras existem no servidor justamente porque **nada que vem do navegador
é confiável**:

- **Preço e frete são recalculados** a cada pedido, a partir do banco. O que o
  navegador manda é descartado — um pedido forjado com preço de R$ 0,01 é
  gravado pelo valor real.
- **Estoque com trava de linha** (`SELECT ... FOR UPDATE` dentro de transação):
  dois pedidos simultâneos do mesmo produto não conseguem furar o estoque.
- **Senhas com bcrypt** (12 rounds). Nem o banco nem os logs veem a senha.
- **Sessão em cookie `httpOnly`**: o JavaScript da página não alcança o token,
  então um XSS não consegue roubá-lo.
- **Cliente só enxerga o que é seu**: pedidos e endereços são filtrados por
  `customer_id` na consulta, não na tela.
- **Rotas de escrita exigem sessão de administrador** — sem sessão dá 401, com
  sessão de cliente dá 403.
- **Toda entrada passa por Zod** antes de chegar ao banco.
- **Dinheiro em `NUMERIC(10,2)`**, não em ponto flutuante.

## Contas de clientes

O cliente cria conta em `/entrar` e acessa `/conta` para ver pedidos anteriores
(com "comprar de novo"), manter endereços com um padrão, e editar dados e
senha. No checkout, quem está logado encontra o formulário preenchido e escolhe
entre os endereços salvos. **Comprar sem cadastro continua funcionando** — o
pedido fica sem vínculo com conta.

## Frete

Tabela por faixa de CEP, gerida em *Painel › Entrega*: o cliente digita o CEP e
recebe preço e prazo da região correspondente. A loja consulta a tabela no
navegador só para exibir o valor enquanto ele digita; **o valor cobrado é o que
o servidor calcula** ao criar o pedido.

As 9 regiões iniciais cobrem o Brasil e são ponto de partida. **Revise antes de
vender:** papel é pesado (uma resma A4 tem ~2,5 kg) e um pedido com dez resmas
custa bem mais para enviar do que a tabela sugere. O cadastro recusa faixas
sobrepostas, que tornariam o preço ambíguo.

Para trocar por cotação real (Correios, Melhor Envio), o ponto de mudança é
`server/lib/shipping.js` — e será preciso acrescentar peso e dimensões ao
cadastro de produto, que nenhuma transportadora dispensa.

## Pagamento

A loja está **preparada** para uma processadora, mas ainda não tem uma. Hoje
`PAYMENT_PROVIDER=manual`: a cobrança é registrada e o acerto acontece fora do
site, por PIX, cartão ou boleto combinados por contato.

### Como está montado

```
server/lib/payments/
  index.js     contrato que toda processadora implementa + registro
  manual.js    adaptador padrão, sem processadora
  service.js   ponte entre pedido e processadora, e aplicação de eventos
server/routes/webhooks.js   recebe as notificações
```

Tabelas: `payments` (uma linha por tentativa de cobrança) e `webhook_events`
(toda notificação recebida, com chave única por evento).

### Asaas — ambiente de teste

O adaptador do Asaas está pronto (`server/lib/payments/asaas.js`) e usa o
**checkout hospedado** deles: a cobrança é criada pela API e o cliente é levado
para a página do Asaas, onde escolhe entre PIX, boleto e cartão. Nenhum dado de
cartão passa por este servidor.

Para testar no sandbox, no `.env` local:

```
PAYMENT_PROVIDER=asaas
PAYMENT_SECRET_KEY=<chave de sandbox, começa com $aact_hmlg_>
PAYMENT_WEBHOOK_SECRET=<um token que você inventa>
ASAAS_BASE_URL=https://api-sandbox.asaas.com/v3
PUBLIC_URL=http://localhost:5173
```

A chave de sandbox sai do painel do Asaas em modo sandbox
(`sandbox.asaas.com`) → Integrações → API. É uma chave diferente da de
produção e não movimenta dinheiro.

**Para o webhook chegar na sua máquina** durante o teste, o Asaas precisa
alcançar `localhost` — o que ele não consegue. Use um túnel:

```bash
npx localtunnel --port 3333
```

Cadastre a URL que ele devolver + `/api/webhooks/payments/asaas` no painel do
Asaas, em Integrações → Webhooks, com o mesmo token do
`PAYMENT_WEBHOOK_SECRET`. Marque os eventos de cobrança (`PAYMENT_CONFIRMED`,
`PAYMENT_RECEIVED`, `PAYMENT_OVERDUE`, `PAYMENT_REFUNDED`).

**Uma trava proposital:** o servidor recusa subir se a chave for de produção e
a API apontar para sandbox, ou o contrário. É o erro mais caro possível nessa
integração — cobrar de verdade achando que está testando.

### Para integrar outra processadora

1. Crie `server/lib/payments/<nome>.js` implementando `createCharge`,
   `verifySignature` e `parseEvent` — o contrato está documentado em
   `index.js`.
2. Registre o adaptador no objeto `providers` de `index.js`.
3. No ambiente, defina `PAYMENT_PROVIDER=<nome>`, `PAYMENT_SECRET_KEY`,
   `PAYMENT_WEBHOOK_SECRET` e `PUBLIC_URL`.
4. No painel da processadora, cadastre o webhook:
   `https://seu-dominio/api/webhooks/payments/<nome>`

Nenhuma rota, tela ou tabela muda. O checkout passa a devolver uma URL de
pagamento, a tela de confirmação mostra "Pagar agora", e o pedido vira `pago`
sozinho quando o webhook chega.

### Quando o webhook não chega

Webhook não é garantia — a notificação se perde, chega durante um reinício, ou
é recusada por um segredo mal configurado. Por isso existe a conferência
manual, que pergunta o estado direto à processadora:

- **Cliente**: botão "Já paguei — conferir agora" na tela do pedido
- **Painel**: botão "Conferir pagamento" no detalhe do pedido

Sem isso, um pedido pago ficaria "aguardando pagamento" para sempre.

### Estoque

Pedido cancelado ou estornado devolve os itens à prateleira. A trava está no
banco (coluna `stock_restored`), não no código que chama: um pedido cancelado e
depois estornado passaria pela devolução duas vezes, e a loja passaria a vender
o que não tem.

### Três coisas que o desenho já resolve

**Dado de cartão nunca passa pelo servidor.** O cliente paga na página da
processadora (checkout hospedado) ou em campos que são iframes dela
(tokenização). Guardar ou trafegar número de cartão exige certificação
PCI-DSS — se algum adaptador aqui receber um, o desenho está errado.

**O webhook confere assinatura antes de qualquer coisa**, sobre o corpo cru da
requisição. Por isso a rota é montada antes do `express.json` em `index.js`:
interpretar o JSON antes reserializa o conteúdo e a conferência falha sempre.

**Evento repetido não conta duas vezes.** A processadora reenvia quando não
recebe 200; o índice único em `webhook_events (provider, event_id)` reconhece
o reenvio e ignora. E um evento atrasado não faz um pedido já enviado voltar
de status.

## Backup

Os dados estão no PostgreSQL:

```bash
pg_dump -U totalpack -d totalpack -F c -f backup.dump
```

Restaurar: `pg_restore -U totalpack -d totalpack backup.dump`. Vale agendar
isso antes de a loja receber pedidos de verdade.

## Antes de abrir ao público

O que ainda falta, em ordem de urgência:

1. **Os pedidos não avisam ninguém.** Eles são gravados no banco e aparecem no
   painel, mas ninguém é notificado. Falta disparar e-mail (ou outro aviso) na
   criação do pedido — o gancho é o final de `POST /api/orders`.
2. **Pagamento.** A estrutura está pronta (ver seção Pagamento), mas nenhuma
   processadora está ligada: as cobranças ficam em `manual` e o acerto é feito
   por contato.
3. **HTTPS e segredos.** Em produção, `NODE_ENV=production` liga o cookie
   `secure`; o `JWT_SECRET` precisa ser longo e ficar fora do repositório.
4. **Limite de tentativas de login.** Não há proteção contra força bruta nas
   rotas de autenticação.
5. **LGPD.** O banco guarda nome, telefone, e-mail e endereço de clientes.
   Falta política de privacidade, consentimento e um caminho para exclusão de
   conta a pedido do titular.
