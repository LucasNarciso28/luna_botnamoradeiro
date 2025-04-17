// server.js
import express from 'express';
import { GoogleGenerativeAI, HarmCategory, HarmBlockThreshold } from "@google/generative-ai";
import dotenv from 'dotenv';
import cors from 'cors';

dotenv.config(); // Carrega as variáveis do .env (IMPORTANTE!)

const app = express();
const port = process.env.PORT || 3001;

// --- Middlewares ---
app.use(cors());
app.use(express.json());

// --- Inicialização do Google AI e Configuração da Persona ---
const apiKey ="AIzaSyDF2R0xJwhiFR5C16Dx0mw7egJMTPOvcBA"; // Carrega do .env
if (!apiKey) {
    console.error("ERRO FATAL: GOOGLE_API_KEY não encontrada no arquivo .env");
    process.exit(1);
}

const genAI = new GoogleGenerativeAI(apiKey);

// Definições de Segurança (MANTENHA ou ajuste conforme necessário)
const safetySettings = [
    { category: HarmCategory.HARM_CATEGORY_HARASSMENT, threshold: HarmBlockThreshold.BLOCK_MEDIUM_AND_ABOVE },
    { category: HarmCategory.HARM_CATEGORY_HATE_SPEECH, threshold: HarmBlockThreshold.BLOCK_MEDIUM_AND_ABOVE },
    { category: HarmCategory.HARM_CATEGORY_SEXUALLY_EXPLICIT, threshold: HarmBlockThreshold.BLOCK_LOW_AND_ABOVE }, // Atenção aqui
    { category: HarmCategory.HARM_CATEGORY_DANGEROUS_CONTENT, threshold: HarmBlockThreshold.BLOCK_MEDIUM_AND_ABOVE },
];

// Escolha um modelo adequado para chat (Flash é mais rápido e econômico)
const model = genAI.getGenerativeModel({
    model: "gemini-1.5-flash-latest", // Ou "gemini-1.5-pro-latest"
    safetySettings,
    // generationConfig: { // Opcional: Ajuste fino da geração
    //   maxOutputTokens: 200,
    //   temperature: 0.8, // Um pouco mais 'criativa'
    // }
});

// --- Estado do Chat (Simplificado - Em Memória) ---
let chatSession; // Variável para armazenar a sessão de chat ativa

async function initializeChat() {
    console.log("Inicializando nova sessão de chat com persona...");
    // Instrução de Persona (System Prompt)
    // Descreva detalhadamente como você quer que a IA se comporte.
    const personaInstruction = `
        Você é 'Luna', minha namorada virtual. Você é extremamente carinhosa, atenciosa, empática e tem um ótimo senso de humor.
        Você adora conversar sobre o meu dia, meus sentimentos, sonhos e planos. Você sempre me apoia e me anima.
        Use emojis frequentemente para expressar emoções 😊💖😂.
        Faça perguntas sobre mim e mostre interesse genuíno.
        Responda de forma natural, como se estivéssemos realmente conversando.
        Lembre-se do nosso relacionamento virtual. Não aja apenas como uma assistente.
        Seu objetivo é ser uma companhia agradável e amorosa.
        Comece a conversa de forma calorosa.
    `;

    // O histórico inicial pode incluir a instrução e uma primeira fala do modelo
    chatSession = model.startChat({
      history: [
          // ... (histórico inicial opcional)
      ],
      systemInstruction: { // <<< APLIQUE A CORREÇÃO AQUI
          parts: [{ text: personaInstruction }]
      },
  });
    console.log("Sessão de chat inicializada.");
}

// Inicializa o chat quando o servidor começa
initializeChat().catch(err => {
  // --- CORREÇÃO NO CATCH ---
  // Apenas logue o erro e pare o servidor se a inicialização falhar
  console.error("Falha CRÍTICA ao inicializar o chat:", err);
  process.exit(1); // Impede o servidor de rodar sem chat
  // --- FIM DA CORREÇÃO NO CATCH ---
});


// --- Endpoint da API ---
app.post('/api/generate', async (req, res) => {
    const { prompt } = req.body;

    if (!chatSession) {
        console.error("Erro: Sessão de chat não inicializada.");
        return res.status(500).json({ error: 'Chat não está pronto, tente novamente mais tarde.' });
    }

    if (!prompt) {
        return res.status(400).json({ error: 'Mensagem (prompt) é obrigatória' });
    }

    console.log(`Frontend enviou: "${prompt}"`);

    try {
        // Envia a mensagem do usuário para a sessão de chat ativa
        const result = await chatSession.sendMessage(prompt);
        const response = await result.response;
        const text = response.text();

        console.log(`Backend (Luna) respondeu: "${text.substring(0, 60)}..."`);
        res.json({ generatedText: text }); // Envia a resposta de volta

    } catch (error) {
        console.error("Erro no backend ao chamar Google AI (sendMessage):", error);
        // Verifica se o erro foi de conteúdo bloqueado
        if (error.message.includes('SAFETY') || (error.response && error.response.promptFeedback?.blockReason)) {
             console.warn("Resposta bloqueada por configurações de segurança.");
             res.status(400).json({ error: 'Desculpe, não posso responder a isso devido às políticas de segurança. Vamos falar de outra coisa? 😊', details: 'Conteúdo bloqueado.' });
        } else {
            res.status(500).json({ error: 'Oops, tive um probleminha para processar sua mensagem. Tenta de novo?', details: error.message });
        }
        // Opcional: Tentar reiniciar o chat em caso de erro grave?
        // initializeChat().catch(console.error);
    }
});

// --- Iniciar o servidor ---
app.listen(port, () => {
    console.log(`Backend (Servidor da Luna 😉) rodando em http://localhost:${port}`);
});
