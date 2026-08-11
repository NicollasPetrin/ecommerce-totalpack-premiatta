import { z } from 'zod'
import { badRequest } from './http.js'
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

const cep = z
  .string()
  .transform((v) => v.replace(/\D/g, ''))
  .refine((v) => v.length === 8, 'CEP deve ter 8 dígitos.')

const money = z.coerce.number().nonnegative('Valor não pode ser negativo.')

/** CPF ou CNPJ com dígito verificador conferido. */
const documento = z
  .string()
  .transform(onlyDigits)
  .refine(isValidDocument, 'CPF ou CNPJ inválido.')

export const schemas = {
  signup: z.object({
    name: z.string().trim().min(3, 'Informe o nome completo.'),
    email: z.string().trim().toLowerCase().email('E-mail inválido.'),
    phone: z.string().trim().min(10, 'Telefone incompleto.'),
    password: z.string().min(8, 'A senha precisa ter ao menos 8 caracteres.'),
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
    current: z.string().min(1, 'Informe a senha atual.'),
    next: z.string().min(8, 'A nova senha precisa ter ao menos 8 caracteres.'),
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
      image: z.string().nullable().default(null),
      specs: z.array(z.string()).default([]),
      featured: z.boolean().default(false),
      active: z.boolean().default(true),
      // Medidas do pacote. Zero é permitido: só impede gerar etiqueta.
      weightG: z.coerce.number().int().min(0, 'Peso inválido.').default(0),
      lengthCm: z.coerce.number().min(0, 'Medida inválida.').default(0),
      widthCm: z.coerce.number().min(0, 'Medida inválida.').default(0),
      heightCm: z.coerce.number().min(0, 'Medida inválida.').default(0),
      variantLabel: z.string().trim().default(''),
      variants: z
        .array(
          z
            .object({
              id: z.string().uuid().nullish(),
              name: z.string().trim().min(1, 'Informe o nome da variação.'),
              sku: z.string().trim().default(''),
              price: money.refine((v) => v > 0, 'Preço deve ser maior que zero.'),
              promo: money.default(0),
              stock: z.coerce.number().int().min(0, 'Estoque inválido.'),
              active: z.boolean().default(true),
            })
            .refine((v) => v.promo === 0 || v.promo < v.price, {
              message: 'A promoção deve ser menor que o preço.',
              path: ['promo'],
            }),
        )
        .default([]),
    })
    .refine((p) => p.promo === 0 || p.promo < p.price, {
      message: 'A promoção deve ser menor que o preço.',
      path: ['promo'],
    })
    /* Uma lista de variações sem nome de eixo não diz nada ao cliente: ele
       veria botões soltos sem saber se escolhe cor ou tamanho. */
    .refine((p) => p.variants.length === 0 || p.variantLabel.length > 0, {
      message: 'Dê um nome ao tipo de variação (ex.: Cor, Tamanho).',
      path: ['variantLabel'],
    })
    .refine(
      (p) => {
        const nomes = p.variants.map((v) => v.name.toLowerCase())
        return new Set(nomes).size === nomes.length
      },
      { message: 'Há variações com o mesmo nome.', path: ['variants'] },
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
  }),

  order: z
    .object({
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
