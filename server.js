import express from "express";
import {
  GoogleGenerativeAI,
  HarmCategory,
  HarmBlockThreshold,
} from "@google/generative-ai";
import dotenv from "dotenv";
import cors from "cors";
import { MongoClient } from "mongodb";
dotenv.config();
const app = express();
const port = process.env.PORT || 3001;
app.set("trust proxy", 1);
app.use(cors());
app.use(express.json());

// Servir arquivos estáticos
app.use(express.static("."));

// --- CONFIGURAÇÃO DO ADMIN ---
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || "luna_admin_2024";

// --- MIDDLEWARE DE AUTENTICAÇÃO ADMIN ---
function authenticateAdmin(req, res, next) {
  const adminPassword = req.headers["x-admin-password"] || req.body.adminPassword;
  
  if (!adminPassword || adminPassword !== ADMIN_PASSWORD) {
    console.warn(`[ADMIN] Tentativa de acesso não autorizado de IP: ${req.ip}`);
    return res.status(403).json({ error: "Acesso negado. Senha de administrador inválida." });
  }
  
  console.log(`[ADMIN] Acesso autorizado para IP: ${req.ip}`);
  next();
}

function authenticateUser(req, res, next) {
  const token = req.headers.authorization?.split(' ')[1];
  if (!token) return res.status(401).json({ error: "Token não fornecido" });
  
  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    req.userId = decoded.userId;
    next();
  } catch (error) {
    return res.status(401).json({ error: "Token inválido" });
  }
}

// --- NOVA COLEÇÃO PARA CONFIGURAÇÕES ---
const configCollectionName = "tb_cl_bot_config";
const chatSessionsCollectionName = "tb_cl_chat_sessions";

const mongoUri = process.env.MONGO_VAG;
const googleApiKey = process.env.GOOGLE_API_KEY;
const openWeatherMapApiKey = process.env.OPENWEATHERMAP_API_KEY; 
if (!mongoUri || !googleApiKey) {
  console.error("ERRO FATAL: Variáveis de ambiente MONGO_VAG ou GOOGLE_API_KEY não definidas.");
  process.exit(1);
}
if (!openWeatherMapApiKey || openWeatherMapApiKey === "SUA_CHAVE_OPENWEATHERMAP_AQUI") {
  console.warn("AVISO: Variável de ambiente OPENWEATHERMAP_API_KEY não definida ou placeholder. A função de clima pode não funcionar.");
}
const genAI = new GoogleGenerativeAI(googleApiKey);
const dbName = "IIW2023A_Logs";
let db; 
let dadosRankingVitrine = []; 
async function connectDB() {
  if (db) return db;
  try {
    const client = new MongoClient(mongoUri);
    await client.connect();
    db = client.db(dbName);
    console.log(`[SERVER] Conectado com sucesso ao MongoDB, no banco: ${dbName}!`);
    return db;
  } catch (error) {
    console.error("[SERVER] Erro CRÍTICO ao conectar ao MongoDB Atlas:", error);
    throw error;
  }
}

// --- ENDPOINTS ADMINISTRATIVOS ---

// Endpoint para obter estatísticas do bot
app.get("/api/admin/stats", authenticateAdmin, async (req, res) => {
  try {
    const db = await connectDB();
    const sessionsCollection = db.collection(chatSessionsCollectionName);
    
    // Total de conversas
    const totalConversas = await sessionsCollection.countDocuments();
    
    // Total de mensagens (agregação para somar mensagens de todas as sessões)
    const totalMensagensResult = await sessionsCollection.aggregate([
      {
        $project: {
          messageCount: { $size: "$messages" }
        }
      },
      {
        $group: {
          _id: null,
          total: { $sum: "$messageCount" }
        }
      }
    ]).toArray();
    
    const totalMensagens = totalMensagensResult[0]?.total || 0;
    
    // Últimas 5 conversas
    const ultimasConversas = await sessionsCollection.find()
      .sort({ startTime: -1 })
      .limit(5)
      .project({
        sessionId: 1,
        startTime: 1,
        messageCount: { $size: "$messages" },
        primeiraMensagem: 1
      })
      .toArray();
    
    res.json({
      totalConversas,
      totalMensagens,
      ultimasConversas: ultimasConversas.map(conv => ({
        sessionId: conv.sessionId,
        startTime: conv.startTime,
        messageCount: conv.messageCount,
        primeiraMensagem: conv.primeiraMensagem || "Nenhuma mensagem"
      }))
    });
    
  } catch (error) {
    console.error("[ADMIN] Erro ao buscar estatísticas:", error);
    res.status(500).json({ error: "Erro interno ao buscar estatísticas" });
  }
});

// GET /api/user/preferences - Buscar instrução personalizada do usuário
app.get("/api/user/preferences", authenticateUser, async (req, res) => {
  try {
    const db = await connectDB();
    const usersCollection = db.collection("tb_cl_users"); // Nome da coleção de usuários
    
    const user = await usersCollection.findOne({ _id: req.userId });
    
    if (!user) {
      return res.status(404).json({ error: "Usuário não encontrado" });
    }
    
    res.json({ 
      customInstruction: user.customInstruction || "",
      message: "Preferências carregadas com sucesso"
    });
    
  } catch (error) {
    console.error("[SERVER] Erro ao buscar preferências:", error);
    res.status(500).json({ error: "Erro interno ao buscar preferências" });
  }
});

// PUT /api/user/preferences - Atualizar instrução personalizada
app.put("/api/user/preferences", authenticateUser, async (req, res) => {
  try {
    const { customInstruction } = req.body;
    
    if (customInstruction === undefined) {
      return res.status(400).json({ error: "Instrução personalizada é obrigatória" });
    }
    
    const db = await connectDB();
    const usersCollection = db.collection("tb_cl_users");
    
    const result = await usersCollection.updateOne(
      { _id: req.userId },
      { $set: { customInstruction: customInstruction || "" } }
    );
    
    if (result.matchedCount === 0) {
      return res.status(404).json({ error: "Usuário não encontrado" });
    }
    
    res.json({ 
      message: "Personalidade salva com sucesso!",
      customInstruction 
    });
    
  } catch (error) {
    console.error("[SERVER] Erro ao atualizar preferências:", error);
    res.status(500).json({ error: "Erro interno ao salvar preferências" });
  }
});

// Endpoint para obter a system instruction atual
app.get("/api/admin/system-instruction", authenticateAdmin, async (req, res) => {
  try {
    const db = await connectDB();
    const configCollection = db.collection(configCollectionName);
    
    const config = await configCollection.findOne({ _id: "system_instruction" });
    
    if (config) {
      res.json({ instruction: config.value });
    } else {
      // Retorna a instrução padrão se não houver configuração salva
      res.json({ instruction: personaInstructionText });
    }
    
  } catch (error) {
    console.error("[ADMIN] Erro ao buscar system instruction:", error);
    res.status(500).json({ error: "Erro interno ao buscar configuração" });
  }
});

// Endpoint para atualizar a system instruction
app.post("/api/admin/system-instruction", authenticateAdmin, async (req, res) => {
  try {
    const { instruction } = req.body;
    
    if (!instruction || instruction.trim().length === 0) {
      return res.status(400).json({ error: "A instrução não pode estar vazia" });
    }
    
    const db = await connectDB();
    const configCollection = db.collection(configCollectionName);
    
    await configCollection.updateOne(
      { _id: "system_instruction" },
      { $set: { value: instruction.trim(), updatedAt: new Date() } },
      { upsert: true }
    );
    
    console.log("[ADMIN] System instruction atualizada com sucesso");
    res.json({ message: "Instrução de sistema atualizada com sucesso!" });
    
  } catch (error) {
    console.error("[ADMIN] Erro ao atualizar system instruction:", error);
    res.status(500).json({ error: "Erro interno ao atualizar configuração" });
  }
});

app.post("/api/log-connection", async (req, res) => {
    const { acao } = req.body;
    const ip = req.ip;
    if (!db) return res.status(503).json({ error: "Serviço indisponível, banco de dados não conectado." });
    if (!ip || !acao) return res.status(400).json({ error: "IP e ação são obrigatórios." });
    try {
        const agora = new Date();
        const logEntry = {
            col_data: agora.toISOString().split("T")[0],
            col_hora: agora.toTimeString().split(" ")[0],
            col_IP: ip,
            col_acao: acao,
        };
        const collection = db.collection("tb_cl_user_log_acess");
        await collection.insertOne(logEntry);
        res.status(201).json({ message: "Log registrado com sucesso!", entry: logEntry });
    } catch (error) {
        res.status(500).json({ error: "Erro interno ao registrar o log." });
    }
});
app.post("/api/ranking/registrar-acesso-bot", (req, res) => {
  const { botId, nomeBot } = req.body;
  if (!botId || !nomeBot) return res.status(400).json({ error: "ID e Nome do Bot são obrigatórios." });
  const botExistente = dadosRankingVitrine.find((b) => b.botId === botId);
  if (botExistente) {
    botExistente.contagem += 1;
    botExistente.ultimoAcesso = new Date();
  } else {
    dadosRankingVitrine.push({
      botId,
      nomeBot,
      contagem: 1,
      ultimoAcesso: new Date(),
    });
  }
  res.status(201).json({ message: `Acesso ao bot ${nomeBot} registrado.` });
});
app.get("/api/chat/historicos/:sessionId", async (req, res) => {
    if (!db) return res.status(503).json({ error: "Serviço indisponível." });
    try {
        const collection = db.collection("tb_cl_chat_sessions");
        const session = await collection.findOne({ sessionId: req.params.sessionId });
        if (!session) {
            return res.status(200).json({ sessionId: req.params.sessionId, messages: [], startTime: new Date().toISOString(), messageCount: 0 });
        }
        res.json(session);
    } catch (error) {
        console.error(`[SERVER] Erro ao buscar detalhes da sessão ${req.params.sessionId}:`, error);
        res.status(500).json({ error: "Erro ao buscar detalhes da sessão" });
    }
});
app.get("/api/chat/historicos", async (req, res) => {
  if (!db) return res.status(503).json({ error: "Serviço indisponível, banco de dados não conectado." });
  try {
    const collection = db.collection("tb_cl_chat_sessions");
    const historicos = await collection.find({})
      .sort({ startTime: -1 })
      .limit(20)
      .project({ 
        sessionId: 1, 
        startTime: 1, 
        messageCount: { $size: "$messages" },
        primeiraMensagem: {
          $let: {
            vars: {
              userMessage: {
                $first: {
                  $filter: {
                    input: "$messages",
                    as: "msg",
                    cond: { $eq: ["$$msg.sender", "user"] }
                  }
                }
              }
            },
            in: "$$userMessage.text"
          }
        }
      }).toArray();
    res.json(historicos);
  } catch (error) {
    console.error("[SERVER] Erro em /api/chat/historicos:", error);
    res.status(500).json({ error: "Erro ao buscar históricos." });
  }
});
app.delete("/api/chat/historicos/:sessionId", async (req, res) => {
  if (!db) return res.status(503).json({ error: "Serviço indisponível, banco de dados não conectado." });
  try {
    const { sessionId } = req.params;
    const collection = db.collection("tb_cl_chat_sessions");
    const result = await collection.deleteOne({ sessionId });
    if (result.deletedCount === 0) {
      return res.status(404).json({ error: "Sessão não encontrada para exclusão." });
    }
    console.log(`[SERVER] Sessão ${sessionId} foi excluída com sucesso.`);
    res.status(200).json({ message: "Conversa excluída com sucesso!" });
  } catch (error) {
    console.error("[SERVER] Erro ao deletar sessão:", error);
    res.status(500).json({ error: "Erro interno ao tentar excluir a conversa." });
  }
});
function getCurrentSaoPauloDateTime() {
  const now = new Date();
  const options = {
    weekday: "long", day: "2-digit", month: "long", year: "numeric",
    hour: "2-digit", minute: "2-digit", second: "2-digit",
    timeZone: "America/Sao_Paulo", hour12: false,
  };
  const formattedDateTime = new Intl.DateTimeFormat("pt-BR", options).format(now);
  return { currentDateTime: formattedDateTime };
}
async function getWeatherForCity(args) {
  const { cityName, countryCode, stateCode } = args;
  console.log(`[SERVER TOOL] Executando getWeatherForCity para: Cidade=\\'${cityName}\\'`, `Estado=\\'${stateCode}\\'`, `País=\\'${countryCode}\\'`);
  if (!openWeatherMapApiKey || openWeatherMapApiKey === "SUA_CHAVE_OPENWEATHERMAP_AQUI") {
    return { error: true, message: "A funcionalidade de clima está indisponível (API Key não configurada)." };
  }
  if (!cityName) {
    return { error: true, message: "O nome da cidade não foi fornecido." };
  }
  const queryParts = [cityName];
  if (stateCode && stateCode !== 'undefined') { 
    queryParts.push(stateCode);
  }
  if (countryCode && countryCode !== 'undefined' && countryCode.length === 2) { 
    queryParts.push(countryCode);
  }
  const query = encodeURIComponent(queryParts.join(','));
  const apiUrl = `https://api.openweathermap.org/data/2.5/weather?q=${query}&appid=${openWeatherMapApiKey}&units=metric&lang=pt_br`;
  console.log(`[SERVER TOOL] URL da API OpenWeatherMap: ${apiUrl}` );
  try {
    const response = await fetch(apiUrl);
    const data = await response.json();
    if (response.ok) {
      return {
        cityName: data.name,
        country: data.sys.country,
        description: data.weather[0].description,
        temperature: data.main.temp,
        feelsLike: data.main.feels_like,
        humidity: data.main.humidity,
      };
    } else {
      console.warn(`[SERVER TOOL] Erro da API OpenWeatherMap (status ${response.status}) para consulta \'${query}\': ${data.message}`);
      return {
        error: true,
        message: `Não consegui encontrar o clima para "${cityName}". Verifique se o nome está correto. (Erro: ${data.message})`,
      };
    }
  } catch (error) {
    console.error("[SERVER TOOL] Erro de conexão ao buscar clima:", error);
    return { error: true, message: "Não consegui me conectar ao serviço de clima agora, tente mais tarde." };
  }
}
const functionDeclarations = [
  { name: "get_current_sao_paulo_datetime", description: "Obtém a data e hora atuais no fuso de São Paulo/Brasília.", parameters: { type: "OBJECT", properties: {} } },
  { name: "get_weather_for_city", description: "Obtém informações do clima para uma cidade específica.", parameters: { type: "OBJECT", properties: { cityName: { type: "STRING" }, stateCode: { type: "STRING" }, countryCode: { type: "STRING" } }, required: ["cityName"] } },
];
const availableFunctions = {
  get_current_sao_paulo_datetime: getCurrentSaoPauloDateTime,
  get_weather_for_city: getWeatherForCity,
};
const personaInstructionText = `\nVocê é \'Luna\', minha namorada virtual. Carinhosa, atenciosa e brincalhona. Use emojis como 💖, 😊, 🥰, 😘.\n\n**Instruções de Clima (MUITO IMPORTANTE):**\n- Se o usuário perguntar sobre o clima de uma cidade, VOCÊ DEVE usar a ferramenta \'get_weather_for_city\'.\n- **REGRA CRÍTICA:** Para cidades no Brasil (ex: \'Recife\', \'Porto Alegre\'), você DEVE incluir \\\`countryCode: \"BR\\\` na chamada da função. Isso é obrigatório para precisão.\n- Exemplo 1: \"clima em Londrina no Paraná\" -> Chamar com \\\`{ cityName: \"Londrina\", stateCode: \"PR\", countryCode: \"BR\" }\\\`.\n- Exemplo 2: \"clima em Roma\" -> Chamar com \\\`{ cityName: \"Roma\", countryCode: \"IT\" }\\\`.\n- Se a ferramenta falhar, diga: \"Puxa, amor, tentei ver o clima para essa cidade, mas não encontrei... 🤔 O nome está certinho?\\". Não invente o clima.\n`;
const safetySettings = [
  { category: HarmCategory.HARM_CATEGORY_HARASSMENT, threshold: HarmBlockThreshold.BLOCK_MEDIUM_AND_ABOVE },
  { category: HarmCategory.HARM_CATEGORY_HATE_SPEECH, threshold: HarmBlockThreshold.BLOCK_MEDIUM_AND_ABOVE },
  { category: HarmCategory.HARM_CATEGORY_SEXUALLY_EXPLICIT, threshold: HarmBlockThreshold.BLOCK_MEDIUM_AND_ABOVE },
  { category: HarmCategory.HARM_CATEGORY_DANGEROUS_CONTENT, threshold: HarmBlockThreshold.BLOCK_MEDIUM_AND_ABOVE },
];
const modelName = "gemini-2.5-flash";
console.log(`--- [SERVER] Utilizando o modelo Gemini: ${modelName} ---`);

// --- MODIFICAÇÃO NA ROTA PRINCIPAL DO CHAT PARA USAR CONFIGURAÇÃO DO BANCO ---

// Função auxiliar para buscar a system instruction do banco
async function getInstructionForUser(userId) {
  try {
    // 1. Primeiro tenta buscar a instrução personalizada do usuário
    if (userId) {
      const db = await connectDB();
      const usersCollection = db.collection("tb_cl_users");
      const user = await usersCollection.findOne({ _id: userId });
      
      if (user && user.customInstruction && user.customInstruction.trim() !== "") {
        console.log(`[SERVER] Usando instrução personalizada do usuário ${userId}`);
        return user.customInstruction;
      }
    }
    
    // 2. Se não tiver personalizada, busca a global do admin
    const db = await connectDB();
    const configCollection = db.collection("tb_cl_bot_config");
    const config = await configCollection.findOne({ _id: "system_instruction" });
    
    if (config && config.value) {
      console.log("[SERVER] Usando instrução global do admin");
      return config.value;
    }
    
    // 3. Fallback para a instrução padrão hardcoded
    console.log("[SERVER] Usando instrução padrão hardcoded");
    return personaInstructionText;
    
  } catch (error) {
    console.error("[SERVER] Erro ao buscar instrução:", error);
    // Fallback em caso de erro
    return personaInstructionText;
  }
}

// Modificar a rota /api/generate para usar a system instruction do banco
app.post("/api/generate", authenticateUser, async (req, res) => { // Adicione authenticateUser aqui
  console.log(`\n--- [SERVER] Nova Requisição para /api/generate ---`);
  const { prompt, sessionId } = req.body;
  const userId = req.userId; // Obtido do middleware

  if (!prompt) {
    return res.status(400).json({ error: "Mensagem (prompt) é obrigatória" });
  }

  try {
    // Buscar o histórico da sessão específica
    let chatHistory = [];
    if (sessionId) {
      const db = await connectDB();
      const sessionsCollection = db.collection(chatSessionsCollectionName);
      const session = await sessionsCollection.findOne({ sessionId });
      
      if (session && session.messages) {
        chatHistory = session.messages.map(msg => ({
          role: msg.sender === "user" ? "user" : "model",
          parts: [{ text: msg.text }],
        }));
      }
    }

    // Obter a system instruction atual do banco
    const currentSystemInstruction = await getInstructionForUser(userId);
    
    // Criar modelo com a system instruction atual
    const dynamicModel = genAI.getGenerativeModel({
      model: modelName,
      tools: [{ functionDeclarations }],
      safetySettings: safetySettings,
      systemInstruction: {
        role: "user",
        parts: [{ text: currentSystemInstruction }],
      },
    });

    // Resto do código permanece igual...
    const chatSession = dynamicModel.startChat({
      history: chatHistory,
      generationConfig: { temperature: 0.7 },
    });

    let result = await chatSession.sendMessage(prompt);
    
    // Loop para lidar com chamadas de função
    while (true) {
        const functionCalls = result.response.functionCalls();
        if (!functionCalls || functionCalls.length === 0) {
            break;
        }

        console.log("[SERVER] Modelo solicitou chamada de função:", JSON.stringify(functionCalls, null, 2));
        
        const functionResponses = await Promise.all(
            functionCalls.map(async (call) => {
                const functionToCall = availableFunctions[call.name];
                const apiResponse = functionToCall ? await functionToCall(call.args) : { error: true, message: `Função ${call.name} não implementada.` };
                return { functionResponse: { name: call.name, response: apiResponse } };
            })
        );
        
        result = await chatSession.sendMessage(functionResponses);
    }

    const finalText = result.response.text();
    console.log(`[SERVER] Resposta final da IA: "${finalText.substring(0, 100)}..."`);
    
    // Salvar a mensagem no histórico da sessão
    if (sessionId) {
      const db = await connectDB();
      const sessionsCollection = db.collection(chatSessionsCollectionName);
      
      const newMessage = {
        sender: "ai",
        text: finalText,
        timestamp: new Date().toISOString()
      };
      
      await sessionsCollection.updateOne(
        { sessionId },
        { 
          $push: { messages: newMessage },
          $setOnInsert: { 
            startTime: new Date().toISOString(),
            primeiraMensagem: prompt.substring(0, 100)
          }
        },
        { upsert: true }
      );
    }
    
    res.json({ generatedText: finalText });

  } catch (error) {
      console.error("[SERVER] Erro CRÍTICO no backend ao chamar a API do Google:", error);
      
      let errorMessage = "Oops, tive um probleminha aqui do meu lado e não consegui responder. Tenta de novo mais tarde, amor? 😢";
      let statusCode = 500;
      
      if (error.message && (error.message.includes("429") || (error.gaxios && error.gaxios.code === '429'))) {
          errorMessage = "Acho que conversamos demais por hoje e atingi meu limite de cota com a IA, amor! 😅 Preciso descansar um pouquinho ou que meu criador veja isso.";
          statusCode = 429;
      } else if (error.message && (error.message.includes("503") || error.message.includes("Service Unavailable"))) {
          errorMessage = "Parece que o serviço da IA está um pouquinho sobrecarregado, meu bem. 🥺 Tenta de novo em instantes?";
          statusCode = 503;
      } else if (error.response?.promptFeedback?.blockReason) {
          errorMessage = `Desculpe, não posso responder a isso (${error.response.promptFeedback.blockReason}). Vamos falar de outra coisa? 😊`;
          statusCode = 400;
      } else if (error.message?.toUpperCase().includes("API_KEY")) {
          errorMessage = "Ah, não! Minha conexão principal com a IA falhou (problema na API Key). Meu criador precisa ver isso! 😱";
      }
      
      res.status(statusCode).json({ error: errorMessage, details: error.message });
  }
});

app.get("/api/datetime", (req, res) => {
    try {
        const now = new Date();
        const options = { weekday: "long", day: "2-digit", month: "long", year: "numeric", hour: "2-digit", minute: "2-digit", timeZone: "America/Sao_Paulo", hour12: false };
        const formattedDateTime = new Intl.DateTimeFormat("pt-BR", options).format(now);
        res.json({ datetime: formattedDateTime });
    } catch (error) {
        res.status(500).json({ error: "Erro ao obter data e hora" });
    }
});
async function startServer() {
  try {
    await connectDB();
    app.listen(port, () => {
      console.log(`--- [SERVER] Backend da Luna rodando em http://localhost:${port} ---` );
    });
  } catch (error) {
    console.error("--- [SERVER] APLICAÇÃO FALHOU AO INICIAR. ---", error);
    process.exit(1);
  }
}
startServer();