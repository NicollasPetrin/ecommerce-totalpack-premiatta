# TotalPack

Loja de material escolar (papel A4, colorset, cadernos, arte) com painel
administrativo completo. React + Vite, sem backend: todo o estado vive no
`localStorage` do navegador.

## Rodar

```bash
npm install
```

```bash
npm run dev
```

Abre em `http://localhost:5173`.

Para gerar a versão de produção:

```bash
npm run build
```

Os arquivos saem em `dist/` e podem ser publicados em qualquer hospedagem
estática (Vercel, Netlify, GitHub Pages, hospedagem comum).

> **Atenção ao publicar:** o app usa rotas de navegador (`/catalogo`,
> `/admin`). O servidor precisa devolver `index.html` para qualquer caminho,
> senão um F5 em `/admin` dá 404. Na Vercel e Netlify isso é automático; no
> Apache, use um `.htaccess` com `FallbackResource /index.html`.

## Painel administrativo

Acesse `/admin`. **Senha padrão: `admin123`** — troque em
*Configurações › Senha de acesso* no primeiro acesso.

O painel tem:

- **Visão geral** — faturamento, ticket médio, valor em estoque, gráfico dos
  últimos 14 dias, mais vendidos, pedidos recentes e alerta de estoque baixo.
- **Pedidos** — busca, filtro por status, detalhe completo do pedido e
  mudança de status (pendente → pago → enviado → entregue, ou cancelado).
- **Produtos** — cadastro completo com preço promocional, estoque, unidade de
  venda, especificações, foto própria ou ilustração vetorial (24 desenhos ×
  12 cores), destaque na home e visibilidade na loja.
- **Categorias** — CRUD e reordenação do menu.
- **Entrega** — regiões por faixa de CEP, com preço e prazo próprios, regra de
  frete grátis, retirada na loja e um simulador para testar qualquer CEP.
- **Configurações** — dados da loja, WhatsApp, chave PIX, limite de estoque
  baixo, troca de senha e backup em JSON.

## Frete

O cálculo é uma **tabela por faixa de CEP**, não uma consulta às
transportadoras: o cliente digita o CEP, o sistema procura a primeira região
ativa que contenha aquele número e mostra preço e prazo. Sem servidor, sem
token, sem chamada externa — funciona em hospedagem estática.

As regiões que vêm cadastradas cobrem o Brasil inteiro e são um ponto de
partida para uma loja em São Paulo. **Revise os valores antes de vender:**
papel é pesado (uma resma A4 tem cerca de 2,5 kg) e um pedido com dez resmas
custa muito mais para enviar do que a tabela sugere. O painel impede o cadastro
de duas regiões com faixas sobrepostas, porque a busca sempre pegaria a
primeira.

Se um CEP não cair em nenhuma região, o cliente vê um aviso e é direcionado ao
WhatsApp ou à retirada — o pedido não é aceito às cegas.

Para trocar por cotação real (Correios, Jadlog, Melhor Envio), o ponto de
mudança é `src/lib/shipping.js`: ele passa a chamar uma função no servidor. Vai
ser preciso hospedar em algo que rode backend (Vercel, por exemplo) e
acrescentar peso e dimensões ao cadastro de produto — nenhuma API cota sem
isso. As telas não mudam.

## Como a loja funciona

O cliente monta a sacola, preenche o checkout (entrega ou retirada) e confirma.
O pedido é gravado, o estoque é baixado automaticamente e a tela final oferece
um botão que abre o WhatsApp com o pedido já formatado — é assim que o pedido
chega até você. Não há cobrança online nem coleta de dados de cartão.

## Estrutura

```
src/
  data/seed.js            catálogo inicial (34 produtos, 7 categorias, 12 pedidos demo)
  lib/format.js           moeda, datas, máscaras, slug
  lib/shipping.js         frete por faixa de CEP
  lib/storage.js          leitura/gravação, backup, hash da senha
  store/StoreContext.jsx  estado global: produtos, pedidos, carrinho, sessão
  components/             Header, Footer, CartDrawer, ProductCard, Modal, Icon…
  components/ProductArt   ilustrações vetoriais dos produtos
  pages/                  Home, Catalog, Product, Checkout, OrderSuccess
  pages/admin/            AdminLayout, Login, Dashboard, Products, Categories,
                          Orders, Shipping, Settings
  styles/tokens.css       design tokens + reset + componentes base
  styles/app.css          loja
  styles/admin.css        painel
```

## Design

Segue as diretrizes da Apple: tipografia grande e hierárquica (fonte do
sistema), muito espaço em branco, barras translúcidas com `backdrop-filter`,
paleta neutra com um único azul de acento, cantos generosos, sombras suaves e
movimento discreto. Modo claro e escuro (automático pelo sistema ou manual pelo
ícone no cabeçalho) e layout responsivo até 375 px.

## Trocar o `localStorage` por um backend

Toda a persistência está isolada em `src/lib/storage.js` e no
`StoreContext`. Para plugar uma API, substitua as chamadas `read`/`write` por
`fetch` — nenhuma tela precisa mudar.

Antes de ir para produção com dinheiro real, mova a autenticação do admin para
o servidor: hoje a senha é verificada no navegador (hash FNV em
`storage.js`), o que serve para uso interno mas não protege contra alguém que
abra o DevTools.

## Backup

*Configurações › Backup e dados* exporta um `.json` com produtos, categorias,
pedidos e configurações, e restaura o mesmo arquivo. Como os dados ficam no
navegador, limpar os dados do site apaga tudo — exporte de tempos em tempos.
