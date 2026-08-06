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
2. **Pagamento.** PIX e boleto são combinados fora do site. Integrar uma
   processadora é o próximo passo natural agora que existe servidor.
3. **HTTPS e segredos.** Em produção, `NODE_ENV=production` liga o cookie
   `secure`; o `JWT_SECRET` precisa ser longo e ficar fora do repositório.
4. **Limite de tentativas de login.** Não há proteção contra força bruta nas
   rotas de autenticação.
5. **LGPD.** O banco guarda nome, telefone, e-mail e endereço de clientes.
   Falta política de privacidade, consentimento e um caminho para exclusão de
   conta a pedido do titular.
