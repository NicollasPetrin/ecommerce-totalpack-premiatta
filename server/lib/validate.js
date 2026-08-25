import { z } from 'zod'
import { badRequest, notFound } from './http.js'
import { isValidDocument, onlyDigits } from './document.js'

/** Valida o corpo da requisição e devolve o objeto já tipado. */
export function parse(schema, data) {
  const result = schema.safeParse(data)
  if (!result.success) {
    const details = {}
    for (const issue of result.error.issues) {
      details[issue.path.join('.') || '_'] = issue.message
    }
    throw badRequest('Dados inválidos.', details)
  }
  return result.data
}

const RE_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/**
 * Confere que o `:id` da URL é mesmo um UUID antes de chegar ao banco.
 *
 * Sem isto, um id inventado vira erro de sintaxe do Postgres e volta como 500
 * — não é falha de segurança, porque a consulta é parametrizada e nada é
 * executado, mas enche o log de ruído e ainda deixa quem sonda a API
 * distinguir "id malformado" de "id que não existe". Com a checagem, os dois
 * respondem 404 igual.
 */
export function validarUuid(req, _res, next, valor) {
  if (!RE_UUID.test(valor)) return next(notFound('Não encontrado.'))
  next()
}

const cep = z
  .string()
  .transform((v) => v.replace(/\D/g, ''))
  .refine((v) => v.length === 8, 'CEP deve ter 8 dígitos.')

const money = z.coerce.number().nonnegative('Valor não pode ser negativo.')

/**
 * Foto de produto.
 *
 * Antes o campo aceitava qualquer string e ela ia direto para o `src` de uma
 * imagem. Isso deixava gravar `javascript:…` ou um data URI de HTML — hoje os
 * navegadores não executam nada disso dentro de <img>, mas o dia em que
 * alguém usar o mesmo valor num link ou num fundo CSS, vira falha. Aqui só
 * passa data URI de formato de imagem conhecido.
 *
 * O teto de 1,5 MB acompanha o limite de 2 MB do corpo da requisição: sem
 * ele, cada produto poderia carregar megabytes que todo visitante baixa.
 */
const MAX_IMAGEM = 1_500_000

const imagem = z
  .string()
  .max(MAX_IMAGEM, 'Imagem muito grande. Use até 1,5 MB.')
  .refine(
    (v) => v === '' || /^data:image\/(png|jpe?g|webp|gif|avif);base64,[A-Za-z0-9+/=]+$/.test(v),
    'Formato de imagem não aceito. Envie PNG, JPG, WebP, GIF ou AVIF.',
  )
  .nullable()
  .default(null)

/** CPF ou CNPJ com dígito verificador conferido. */
const documento = z
  .string()
  .transform(onlyDigits)
  .refine(isValidDocument, 'CPF ou CNPJ inválido.')

export const schemas = {
  signup: z.object({
    // Mesma armadilha do pedido.
    website: z.string().max(200).optional().default(''),
    name: z.string().trim().min(3, 'Informe o nome completo.'),
    email: z.string().trim().toLowerCase().email('E-mail inválido.'),
    phone: z.string().trim().min(10, 'Telefone incompleto.'),
    password: z
      .string()
      .min(8, 'A senha precisa ter ao menos 8 caracteres.')
      // Teto porque o bcrypt custa proporcional ao tamanho: uma senha de
      // megabytes seria negacao de servico barata.
      .max(200, 'Senha longa demais.'),
  }),

  login: z.object({
    email: z.string().trim().toLowerCase().email('E-mail inválido.'),
    password: z.string().min(1, 'Informe a senha.'),
  }),

  profile: z.object({
    name: z.string().trim().min(3, 'Informe o nome completo.'),
    email: z.string().trim().toLowerCase().email('E-mail inválido.'),
    phone: z.string().trim().min(10, 'Telefone incompleto.'),
  }),

  passwordChange: z.object({
    current: z.string().min(1, 'Informe a senha atual.').max(200),
    next: z
      .string()
      .min(8, 'A nova senha precisa ter ao menos 8 caracteres.')
      .max(200, 'Senha longa demais.'),
  }),

  address: z.object({
    label: z.string().trim().max(40).default('Endereço'),
    cep,
    street: z.string().trim().min(1, 'Informe a rua.'),
    number: z.string().trim().min(1, 'Informe o número.'),
    complement: z.string().trim().default(''),
    district: z.string().trim().min(1, 'Informe o bairro.'),
    city: z.string().trim().min(1, 'Informe a cidade.'),
    state: z.string().trim().length(2, 'UF deve ter 2 letras.').toUpperCase(),
    isDefault: z.boolean().default(false),
  }),

  category: z.object({
    name: z.string().trim().min(2, 'Informe o nome.'),
    slug: z.string().trim().min(1),
    description: z.string().trim().default(''),
    position: z.coerce.number().int().min(0).default(99),
  }),

  product: z
    .object({
      name: z.string().trim().min(3, 'Informe o nome do produto.'),
      categoryId: z.string().uuid('Escolha uma categoria.').nullable(),
      sku: z.string().trim().default(''),
      description: z.string().trim().default(''),
      price: money.refine((v) => v > 0, 'Preço deve ser maior que zero.'),
      promo: money.default(0),
      stock: z.coerce.number().int().min(0, 'Estoque inválido.'),
      unit: z.string().trim().default('unidade'),
      art: z.string().trim().default('sheet'),
      tint: z.string().trim().default('#0071e3'),
      image: imagem,
      specs: z.array(z.string()).default([]),
      featured: z.boolean().default(false),
      active: z.boolean().default(true),
      // Medidas do pacote. Zero é permitido: só impede gerar etiqueta.
      weightG: z.coerce.number().int().min(0, 'Peso inválido.').default(0),
      lengthCm: z.coerce.number().min(0, 'Medida inválida.').default(0),
      widthCm: z.coerce.number().min(0, 'Medida inválida.').default(0),
      heightCm: z.coerce.number().min(0, 'Medida inválida.').default(0),

      /* Dados fiscais. Como as medidas, ficar em branco é permitido: o produto
         vende, só não entra em nota. Recusar o cadastro incompleto obrigaria a
         ter o NCM em mãos para lançar um produto, e não é assim que se
         trabalha — o NCM chega depois, do contador ou do fornecedor. */
      ncm: z
        .string()
        .trim()
        // Aceita "4802.56.99" como se digita na tabela e guarda só os dígitos.
        .transform((v) => v.replace(/\D/g, ''))
        .refine((v) => v === '' || v.length === 8, 'O NCM tem 8 dígitos.')
        .default(''),
      // Unidade tributável: 'UN', 'CX', 'RM'. Máximo de 6 no emissor.
      unitTrib: z.string().trim().toUpperCase().max(6, 'Unidade fiscal muito longa.').default(''),
      gtin: z
        .string()
        .trim()
        .transform((v) => v.replace(/\D/g, ''))
        .refine(
          (v) => v === '' || [8, 12, 13, 14].includes(v.length),
          'O código de barras tem 8, 12, 13 ou 14 dígitos.',
        )
        .default(''),
      // Classificação tributária da Reforma; só vale para Regime Normal.
      cclassTrib: z.string().trim().max(20).default(''),

      /* Grade: eixos com as suas opções.
       *
       * Os tetos existem porque o smoke test mostrou que sem eles um erro de
       * digitação (100 opções em dois eixos) grava 10 mil combinações, e o
       * catálogo — que todo visitante baixa inteiro — passou de 4 MB. Os
       * números seguem o que os marketplaces praticam e sobram para qualquer
       * papelaria real. */
      variantAxes: z
        .array(
          z.object({
            name: z
              .string()
              .trim()
              .min(1, 'Dê um nome ao eixo (ex.: Cor).')
              .max(40, 'Nome do eixo muito longo.'),
            options: z
              .array(z.string().trim().min(1).max(40, 'Opção muito longa.'))
              .min(1, 'Cada eixo precisa de ao menos uma opção.')
              .max(60, 'Máximo de 60 opções por eixo.'),
          }),
        )
        .max(3, 'Máximo de 3 eixos de variação.')
        .default([]),
      variants: z
        .array(
          z
            .object({
              id: z.string().uuid().nullish(),
              name: z.string().trim().min(1, 'Informe o nome da variação.').max(160),
              options: z.record(z.string().max(40), z.string().max(40)).default({}),
              sku: z.string().trim().max(60).default(''),
              gtin: z.string().trim().max(14).default(''),
              price: money.refine((v) => v > 0, 'Preço deve ser maior que zero.'),
              promo: money.default(0),
              stock: z.coerce.number().int().min(0, 'Estoque inválido.'),
              active: z.boolean().default(true),
              /* Zero = herda a medida do produto. É o caso comum, de grade que
                 varia só em cor; preencher aqui é para quando a variação muda
                 a quantidade e portanto o peso. */
              weightG: z.coerce.number().int().min(0, 'Peso inválido.').default(0),
              lengthCm: z.coerce.number().min(0, 'Medida inválida.').default(0),
              widthCm: z.coerce.number().min(0, 'Medida inválida.').default(0),
              heightCm: z.coerce.number().min(0, 'Medida inválida.').default(0),
            })
            .refine((v) => v.promo === 0 || v.promo < v.price, {
              message: 'A promoção deve ser menor que o preço.',
              path: ['promo'],
            }),
        )
        .max(300, 'Máximo de 300 combinações por produto.')
        .default([]),
    })
    .refine((p) => p.promo === 0 || p.promo < p.price, {
      message: 'A promoção deve ser menor que o preço.',
      path: ['promo'],
    })
    /* Uma lista de variações sem eixo não diz nada ao cliente: ele veria
       botões soltos sem saber se escolhe cor ou tamanho. */
    .refine((p) => p.variants.length === 0 || p.variantAxes.length > 0, {
      message: 'Defina ao menos um eixo de variação (ex.: Cor).',
      path: ['variantAxes'],
    })
    .refine(
      (p) => {
        const eixos = p.variantAxes.map((a) => a.name.toLowerCase())
        return new Set(eixos).size === eixos.length
      },
      { message: 'Há eixos com o mesmo nome.', path: ['variantAxes'] },
    )
    .refine(
      (p) =>
        p.variantAxes.every((a) => {
          const o = a.options.map((x) => x.toLowerCase())
          return new Set(o).size === o.length
        }),
      { message: 'Há opções repetidas dentro de um eixo.', path: ['variantAxes'] },
    )
    /* Cada variação precisa marcar um ponto da grade, com valor válido em
       todos os eixos. Sem isso a loja não conseguiria resolver qual variação
       corresponde à escolha do cliente. */
    .refine(
      (p) =>
        p.variants.every((v) =>
          p.variantAxes.every((a) => a.options.includes(v.options?.[a.name])),
        ),
      {
        message: 'Há variação que não corresponde às opções dos eixos.',
        path: ['variants'],
      },
    )
    .refine(
      (p) => {
        // Duas variações no mesmo ponto da grade seriam dois estoques para a
        // mesma coisa. O banco também barra, mas aqui a mensagem é melhor.
        const pontos = p.variants.map((v) =>
          p.variantAxes.map((a) => v.options?.[a.name]).join(' / '),
        )
        return new Set(pontos).size === pontos.length
      },
      { message: 'Há duas variações para a mesma combinação.', path: ['variants'] },
    ),

  zone: z
    .object({
      name: z.string().trim().min(2, 'Informe o nome da região.'),
      cepStart: cep,
      cepEnd: cep,
      fee: money,
      days: z.coerce.number().int().min(1, 'Informe ao menos 1 dia.'),
      active: z.boolean().default(true),
    })
    .refine((z_) => z_.cepStart <= z_.cepEnd, {
      message: 'O CEP final precisa ser maior que o inicial.',
      path: ['cepEnd'],
    }),

  settings: z.object({
    storeName: z.string().trim().min(1),
    tagline: z.string().trim().default(''),
    email: z.string().trim().email('E-mail inválido.'),
    phone: z.string().trim().default(''),
    address: z.string().trim().default(''),
    hours: z.string().trim().default(''),
    instagram: z.string().trim().default(''),
    pixKey: z.string().trim().default(''),
    freeShippingFrom: money,
    lowStockThreshold: z.coerce.number().int().min(0),

    /* Remetente da etiqueta. Vazio é permitido — a loja funciona sem, só não
       emite etiqueta. O CEP guarda só dígitos, como o do pedido. */
    senderName: z.string().trim().max(120).default(''),
    senderDoc: z.string().trim().transform(onlyDigits).default(''),
    senderCep: z
      .string()
      .trim()
      .transform((v) => v.replace(/\D/g, ''))
      .refine((v) => v === '' || v.length === 8, 'CEP deve ter 8 dígitos.')
      .default(''),
    senderStreet: z.string().trim().max(160).default(''),
    senderNumber: z.string().trim().max(20).default(''),
    senderCompl: z.string().trim().max(80).default(''),
    senderDistrict: z.string().trim().max(80).default(''),
    senderCity: z.string().trim().max(80).default(''),
    senderState: z
      .string()
      .trim()
      .toUpperCase()
      .refine((v) => v === '' || v.length === 2, 'UF deve ter 2 letras.')
      .default(''),

    /* Token da transportadora. Fica aqui e nao no ambiente porque trocar
       variavel no Railway exige deploy, e deploy pode falhar. */
    melhorenvioToken: z.string().trim().max(4000).default(''),
    autoLabel: z.boolean().default(true),
    emailKey: z.string().trim().max(400).default(''),
    notifyEmail: z.string().trim().max(160).default(''),
    notifyCustomer: z.boolean().default(true),
    fiscalKey: z.string().trim().max(400).default(''),
    autoInvoice: z.boolean().default(true),
    fiscalSandbox: z.boolean().default(false),
    fiscalBankId: z.string().trim().max(30).default(''),
    fiscalWebhookSecret: z.string().trim().max(200).default(''),
  }),

  order: z
    .object({
      /* Armadilha para robô: o campo existe no formulário, fica escondido do
         olho e do leitor de tela, e ninguém de verdade o preenche. Preenchedor
         automático de formulário preenche tudo que encontra — é o jeito mais
         barato de separar os dois, sem CAPTCHA e sem atrito para quem compra.

         Aceita string em vez de recusar no schema: a recusa acontece na rota,
         com resposta de sucesso falso, para o robô não aprender o que o
         denunciou. */
      website: z.string().max(200).optional().default(''),
      // O cliente manda o que quer comprar; preço e frete são do servidor.
      items: z
        .array(
          z.object({
            productId: z.string().uuid(),
            // Ausente em produto sem variação.
            variantId: z.string().uuid().nullish(),
            qty: z.coerce.number().int().positive(),
          }),
        )
        .min(1, 'Sacola vazia.'),
      /* Qual serviço de frete o cliente escolheu. É só uma referência: o
         servidor recota e usa o preço dele, nunca o que veio no corpo. */
      shippingServiceId: z.string().trim().max(40).optional(),
      name: z.string().trim().min(3, 'Informe o nome completo.'),
      email: z.string().trim().toLowerCase().email('E-mail inválido.').or(z.literal('')),
      phone: z.string().trim().min(10, 'Telefone incompleto.'),
      // Exigido pela processadora para emitir a cobrança.
      cpfCnpj: documento,
      // A loja deixou de oferecer retirada. O valor 'retirada' continua no
      // banco por causa dos pedidos antigos, mas não é aceito em novos.
      delivery: z.literal('entrega').default('entrega'),
      payment: z.enum(['pix', 'boleto', 'cartao']),
      note: z.string().trim().max(500).default(''),
      cep: z.string().default(''),
      street: z.string().trim().default(''),
      number: z.string().trim().default(''),
      complement: z.string().trim().default(''),
      district: z.string().trim().default(''),
      city: z.string().trim().default(''),
      state: z.string().trim().default(''),
      saveAddress: z.boolean().default(false),
      addressLabel: z.string().trim().default(''),
    })
    .superRefine((o, ctx) => {
      const digits = o.cep.replace(/\D/g, '')
      if (digits.length !== 8) {
        ctx.addIssue({ code: 'custom', path: ['cep'], message: 'CEP incompleto.' })
      }
      for (const [field, label] of [
        ['street', 'a rua'],
        ['number', 'o número'],
        ['district', 'o bairro'],
        ['city', 'a cidade'],
      ]) {
        if (!o[field]) {
          ctx.addIssue({ code: 'custom', path: [field], message: `Informe ${label}.` })
        }
      }
      if (o.state.length !== 2) {
        ctx.addIssue({ code: 'custom', path: ['state'], message: 'UF inválida.' })
      }
    }),

  orderStatus: z.object({
    status: z.enum(['pendente', 'pago', 'enviado', 'entregue', 'cancelado']),
  }),
}
