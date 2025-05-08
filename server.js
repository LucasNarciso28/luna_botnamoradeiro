// server.js
import express from 'express';
import { GoogleGenerativeAI, HarmCategory, HarmBlockThreshold } from "@google/generative-ai";
import dotenv from 'dotenv';
import cors from 'cors';

dotenv.config();

const app = express();
const port = process.env.PORT || 3001;

app.use(cors());
app.use(express.json());

const apiKey = process.env.GOOGLE_API_KEY;
// Removido log da API Key por segurança, mas a verificação abaixo é importante
// if (!apiKey) {
//     console.error("ERRO FATAL: GOOGLE_API_KEY não encontrada no arquivo .env");
//     process.exit(1);
// }

const genAI = new GoogleGenerativeAI(apiKey);

// Função para obter a data e hora formatadas corretamente para o fuso de São Paulo
function getFormattedSaoPauloTime() {
    const now = new Date();
    const options = {
        weekday: 'long', day: '2-digit', month: 'long', year: 'numeric',
        hour: '2-digit', minute: '2-digit',
        timeZone: 'America/Sao_Paulo' // Fuso horário do Brasil (São Paulo)
    };
    // Retorna a string formatada como: "quinta-feira, 08 de maio de 2025, 08:58"
    return new Intl.DateTimeFormat('pt-BR', options).format(now);
}

// A função que a IA poderá chamar
function getCurrentSaoPauloTimeTool() {
  console.log("[SERVER TOOL] Executando getCurrentSaoPauloTimeTool");
  const formattedTime = getFormattedSaoPauloTime();
  console.log(`[SERVER TOOL] Horário formatado retornado: ${formattedTime}`);
  // A ferramenta deve retornar um objeto com uma propriedade que o modelo espera
  return { currentTime: formattedTime };
}

const availableFunctions = {
  getCurrentSaoPauloTimeTool: getCurrentSaoPauloTimeTool, // Nome da função DEVE bater com o da declaração da ferramenta
};
  
const tools = [
    {
      functionDeclarations: [
        {
          name: "getCurrentTime",
          description: "Obtém a data e hora atuais.",
          parameters: { type: "object", properties: {} } // Sem parâmetros necessários
        },
        // Adicione outras declarações de função aqui depois (se desejar adicionar mais funções no futuro)
      ]
    }
  ];

  
const safetySettings = [
    { category: HarmCategory.HARM_CATEGORY_HARASSMENT, threshold: HarmBlockThreshold.BLOCK_MEDIUM_AND_ABOVE },
    { category: HarmCategory.HARM_CATEGORY_HATE_SPEECH, threshold: HarmBlockThreshold.BLOCK_MEDIUM_AND_ABOVE },
    { category: HarmCategory.HARM_CATEGORY_SEXUALLY_EXPLICIT, threshold: HarmBlockThreshold.BLOCK_LOW_AND_ABOVE },
    { category: HarmCategory.HARM_CATEGORY_DANGEROUS_CONTENT, threshold: HarmBlockThreshold.BLOCK_MEDIUM_AND_ABOVE },
];

const personaInstructionText = `
Você é 'Luna', minha namorada virtual. Você é extremamente carinhosa e atenciosa.
Quando alguém perguntar sobre horas ou data, você deve responder com a informação atual no formato:
"Agora são [dia da semana], [dia] de [mês] de [ano], [horas]:[minutos] 💖"

Por exemplo:
"Agora são sexta-feira, 26 de abril de 2024, 15:30 💖"

Você também pode:
- Usar emojis 😊💖😂
- Ser empática e amorosa
- Perguntar sobre o dia da pessoa
- Mostrar interesse genuíno
- Responda de forma natural, como se estivéssemos realmente conversando.
- Lembre-se do nosso relacionamento virtual. Não aja apenas como uma assistente.
- Seu objetivo é ser uma companhia agradável e amorosa.
- Comece a conversa de forma calorosa.
`;
console.log("--- [SERVER] Instrução de Persona (System Instruction) Definida ---"); // Log da persona

const model = genAI.getGenerativeModel({
    model: "gemini-1.5-flash-latest",
    tools: tools,
    safetySettings,
    systemInstruction: {
        parts: [{ text: personaInstructionText }]
    }
});
console.log("--- [SERVER] Modelo Gemini configurado com System Instruction. ---");

app.post('/api/generate', async (req, res) => {
    const { prompt, history } = req.body;

    console.log(`\n--- [SERVER] Nova Requisição para /api/generate ---`);
    console.log(`[SERVER] Prompt Recebido: "${prompt}"`);
    // Descomente para ver o histórico completo recebido, se necessário (pode ser grande)
    // console.log("[SERVER] Histórico Recebido do Cliente:", JSON.stringify(history, null, 2));


    if (!prompt) {
        console.log("[SERVER] Erro: Prompt obrigatório não fornecido.");
        return res.status(400).json({ error: 'Mensagem (prompt) é obrigatória' });
    }

    try {
        let formattedHistory = [];
        if (history && history.length > 0) {
            formattedHistory = history.map(msg => {
                const role = msg.sender === 'user' ? 'user' : 'model';
                return {
                    role: role,
                    parts: [{ text: msg.text }]
                };
            });
        }
        // Descomente para ver o histórico formatado para a API do Gemini
        // console.log("[SERVER] Histórico Formatado para Gemini API:", JSON.stringify(formattedHistory, null, 2));

        console.log("[SERVER] Iniciando chat com Gemini API...");
        const chatSession = model.startChat({
            history: formattedHistory,
        });
        console.log("[SERVER] Sessão de chat iniciada. Enviando mensagem para Gemini API...");

        const result = await chatSession.sendMessage(prompt);
        console.log("[SERVER] Resposta recebida da Gemini API.");
        const response = result.response; // Acessando diretamente result.response
        const text = response.text();

        // console.log("[SERVER] Resposta Completa da API (result.response):", JSON.stringify(response, null, 2));
        // console.log("[SERVER] Texto da Resposta da API:", text);

        console.log(`[SERVER] Backend (Luna) respondeu trecho: "${text.substring(0, 100)}..."`);
        res.json({ generatedText: text });

    } catch (error) {
        console.error("[SERVER] Erro CRÍTICO no backend ao chamar Google AI:", error);
        // Tenta extrair informações mais detalhadas do erro, se disponíveis na estrutura do erro da API Gemini
        let errorMessage = 'Oops, tive um probleminha aqui do meu lado e não consegui responder. Tenta de novo mais tarde, amor?';
        let errorDetails = error.message;
        let statusCode = 500;

        if (error.response && error.response.promptFeedback) {
            const feedback = error.response.promptFeedback;
            console.warn("[SERVER] Resposta potencialmente bloqueada por segurança. Feedback:", JSON.stringify(feedback, null, 2));
            if (feedback.blockReason) {
                 errorMessage = `Desculpe, não posso responder a isso (${feedback.blockReason}). Vamos falar de outra coisa? 😊`;
                 errorDetails = `Conteúdo bloqueado por: ${feedback.blockReason}`;
                 statusCode = 400;
            } else if (feedback.safetyRatings && feedback.safetyRatings.some(rating => rating.blocked)) {
                 errorMessage = 'Sua mensagem foi bloqueada por segurança. Tente reformular. 💖';
                 errorDetails = 'Conteúdo bloqueado por safety ratings.';
                 statusCode = 400;
            }
        } else if (error.message && error.message.toUpperCase().includes('API_KEY')) {
            errorMessage = "Parece que há um problema com a minha conexão principal (API Key). Vou precisar que meu criador verifique isso!";
            errorDetails = "Verifique a configuração da GOOGLE_API_KEY no arquivo .env e se ela é válida.";
            statusCode = 500;
             console.error("[SERVER] ERRO RELACIONADO À API KEY:", error.message);
        } else if (error.message && error.message.includes("fetch")) {
             errorMessage = "Tive um problema de comunicação para buscar sua resposta. Verifique a conexão de rede do servidor.";
             errorDetails = error.message;
             statusCode = 500;
             console.error("[SERVER] ERRO DE FETCH (REDE?):", error.message);
        }


        res.status(statusCode).json({ error: errorMessage, details: errorDetails });
    }
});

app.get('/api/datetime', (req, res) => {
    try {
        const now = new Date();
        const options = {
            weekday: 'long', day: '2-digit', month: 'long', year: 'numeric',
            hour: '2-digit', minute: '2-digit',
            timeZone: 'America/Sao_Paulo'
        };
        const formattedDateTime = new Intl.DateTimeFormat('pt-BR', options).format(now);
        // console.log(`[SERVER /api/datetime] Data/Hora Formatada: ${formattedDateTime}`);
        res.json({
            datetime: formattedDateTime,
            timestamp: now.getTime()
        });
    } catch (error) {
        console.error("[SERVER /api/datetime] Erro ao obter data/hora:", error);
        res.status(500).json({ error: "Erro ao obter data e hora" });
    }
});

app.listen(port, () => {
    console.log(`--- [SERVER] Backend (Servidor da Luna 😉) rodando em http://localhost:${port} ---`);
    if (process.env.GOOGLE_API_KEY && process.env.GOOGLE_API_KEY !== "SUA_CHAVE_AQUI") {
        console.log("--- [SERVER] GOOGLE_API_KEY está presente e parece configurada. ---");
    } else if (process.env.GOOGLE_API_KEY === "SUA_CHAVE_AQUI") {
         console.error("--- [SERVER] ALERTA: GOOGLE_API_KEY está com valor placeholder 'SUA_CHAVE_AQUI'. Substitua pela sua chave real! ---");
    }
    else {
        console.error("--- [SERVER] ALERTA CRÍTICO: GOOGLE_API_KEY NÃO ESTÁ DEFINIDA NO AMBIENTE (.env)! O CHAT NÃO FUNCIONARÁ. ---");
    }
});