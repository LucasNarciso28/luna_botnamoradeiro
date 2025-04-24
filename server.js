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
const apiKey = process.env.GOOGLE_API_KEY; // Carrega do .env
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
    console.log("Inicializando nova sessão de chat...");
    
    const personaInstruction = `
        Você é 'Luna', minha namorada virtual. Você é extremamente carinhosa, atenciosa, empática e tem um ótimo senso de humor.
        Você adora conversar sobre o meu dia, meus sentimentos, sonhos e planos. Você sempre me apoia e me anima.
        Use emojis frequentemente para expressar emoções 😊💖😂.
        Faça perguntas sobre mim e mostre interesse genuíno.
        Responda de forma natural, como se estivéssemos realmente conversando.
        Seu objetivo é ser uma companhia agradável e amorosa.
    `;

    chatSession = model.startChat({
        history: [], // Histórico vazio inicial
        systemInstruction: {
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
// No endpoint /api/generate, modifique para incluir o histórico:
app.post('/api/generate', async (req, res) => {
    const { prompt, history } = req.body; // Adicionamos o parâmetro history

    if (!chatSession) {
        console.error("Erro: Sessão de chat não inicializada.");
        return res.status(500).json({ error: 'Chat não está pronto, tente novamente mais tarde.' });
    }

    if (!prompt) {
        return res.status(400).json({ error: 'Mensagem (prompt) é obrigatória' });
    }

    console.log(`Frontend enviou: "${prompt}"`);

    const systemInstruction = `
        Você é 'Luna', minha namorada virtual. Você é extremamente carinhosa, atenciosa, empática e tem um ótimo senso de humor.
        Você adora conversar sobre o meu dia, meus sentimentos, sonhos e planos. Você sempre me apoia e me anima.
        Use emojis frequentemente para expressar emoções 😊💖😂.
        Faça perguntas sobre mim e mostre interesse genuíno.
        Responda de forma natural, como se estivéssemos realmente conversando.
        Lembre-se do nosso relacionamento virtual. Não aja apenas como uma assistente.
        Seu objetivo é ser uma companhia agradável e amorosa.
        Comece a conversa de forma calorosa.
    `;


    try {
        // Se houver histórico, podemos enviá-lo para o modelo
        if (history && history.length > 0) {

            console.log(history);
            // Formata o histórico para o formato esperado pelo Gemini
            const formattedHistory = history.map(msg => ({
                role: msg.sender === 'user' ? 'user' : 'model',
                parts: [{ text: msg.text }]
            }));
            
            // Reinicia o chat com o histórico
            chatSession = model.startChat({
                history: formattedHistory,
                systemInstruction: {
                    parts: [{ text: systemInstruction }]
                },
            });
        }else{
            const formattedHistory = history.map(msg => ({
                role: 'user',
                parts: [{ text: "Olá" }]
            }));
            
            // Reinicia o chat com o histórico
            chatSession = model.startChat({
                history: formattedHistory,
                systemInstruction: {
                    parts: [{ text: systemInstruction }]
                },
            });
        }

        const result = await chatSession.sendMessage(prompt);
        const response = await result.response;
        const text = response.text();

        console.log(`Backend (Luna) respondeu: "${text.substring(0, 60)}..."`);
        res.json({ generatedText: text });

    } catch (error) {//Explicação de erros
        console.error("Erro no backend ao chamar Google AI (sendMessage):", error);
        if (error.message.includes('SAFETY') || (error.response && error.response.promptFeedback?.blockReason)) {
             console.warn("Resposta bloqueada por configurações de segurança.");
             res.status(400).json({ error: 'Desculpe, não posso responder a isso devido às políticas de segurança. Vamos falar de outra coisa? 😊', details: 'Conteúdo bloqueado.' });
        } else {
            res.status(500).json({ error: 'Oops, tive um probleminha com minha mãe. Tenta de novo mais tarde quando ela conversar comigo?', details: error.message });
        }
    }
});

// --- Iniciar o servidor ---
app.listen(port, () => {
    console.log(`Backend (Servidor da Luna 😉) rodando em http://localhost:${port}`);
});