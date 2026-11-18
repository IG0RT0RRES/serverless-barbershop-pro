import { createClient } from '@supabase/supabase-js';

// Inicializa o Supabase usando as variáveis de ambiente configuradas na Vercel
const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY; // Chave privada de servidor
const apiSecret = process.env.APP_API_SECRET; // Senha entre seu App Flet e a Vercel

const supabase = createClient(supabaseUrl, supabaseKey);

export default async function handler(req, res) {
  // 1. Configuração básica de CORS (caso precise chamar de algum painel web também)
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, x-api-secret, Authorization');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  // 2. Aceita apenas requisições POST
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Método não permitido. Use POST.' });
  }

  // 3. Trava de segurança: verifica se o App enviou o segredo correto
  const clientSecret = req.headers['x-api-secret'];
  if (apiSecret && clientSecret !== apiSecret) {
    return res.status(401).json({ error: 'Não autorizado. Chave de API inválida.' });
  }

  try {
    const {
      table,        // Nome da tabela (ex: "barbers", "appointments")
      action,       // "select", "insert", "update", "delete", "upsert", "rpc"
      columns = '*',// Colunas para o select (ex: "*, barber_portfolio(*)")
      data,         // Objeto ou lista de objetos para insert/update/upsert
      filters = [], // Lista de filtros: [{ column: "id", op: "eq", value: "123" }]
      order,        // Objeto de ordenação: { column: "created_at", ascending: false }
      limit,        // Número máximo de registros
      single = false, // Booleano: true se quiser .single()
      rpcName,      // Nome da função caso action === "rpc"
      rpcParams = {}// Parâmetros da função RPC
    } = req.body;

    // Caso especial: Chamada de Função RPC (Stored Procedure no Supabase)
    if (action === 'rpc') {
      if (!rpcName) return res.status(400).json({ error: 'rpcName é obrigatório para action="rpc"' });
      const { data: result, error } = await supabase.rpc(rpcName, rpcParams);
      if (error) throw error;
      return res.status(200).json({ data: result });
    }

    if (!table || !action) {
      return res.status(400).json({ error: 'Os campos "table" e "action" são obrigatórios.' });
    }

    // Inicia a query na tabela informada
    let query = supabase.from(table);

    // Define a operação principal
    switch (action) {
      case 'select':
        query = query.select(columns);
        break;
      case 'insert':
        query = query.insert(data).select(columns);
        break;
      case 'update':
        query = query.update(data).select(columns);
        break;
      case 'upsert':
        query = query.upsert(data).select(columns);
        break;
      case 'delete':
        query = query.delete().select(columns);
        break;
      default:
        return res.status(400).json({ error: `Ação inválida: ${action}` });
    }

    // Aplica os filtros dinamicamente (ex: .eq('barber_id', '123'))
    if (Array.isArray(filters)) {
      for (const f of filters) {
        if (f.column && f.op && typeof query[f.op] === 'function') {
          query = query[f.op](f.column, f.value);
        }
      }
    }

    // Aplica ordenação, se houver
    if (order && order.column) {
      query = query.order(order.column, { ascending: order.ascending ?? true });
    }

    // Aplica limite, se houver
    if (limit) {
      query = query.limit(limit);
    }

    // Retorna registro único, se solicitado
    if (single) {
      query = query.single();
    }

    // Executa no Supabase
    const { data: result, error } = await query;

    if (error) {
      return res.status(400).json({ error: error.message, details: error });
    }

    return res.status(200).json({ data: result });

  } catch (err) {
    console.error('Erro no Supabase Proxy:', err);
    return res.status(500).json({ error: err.message || 'Erro interno no servidor.' });
  }
}
