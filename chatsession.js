// models/ChatSession.js
import mongoose from 'mongoose';

const chatSessionSchema = new mongoose.Schema({
  sessionId: {
    type: String,
    required: true,
    unique: true,
    index: true
  },
  botId: {
    type: String,
    required: true,
    default: 'luna-namoradeira'
  },
  startTime: {
    type: Date,
    required: true,
    index: -1 // Índice decrescente para ordenação
  },
  endTime: {
    type: Date
  },
  messages: [{
    sender: {
      type: String,
      enum: ['user', 'ai'],
      required: true
    },
    text: {
      type: String,
      required: true
    },
    timestamp: {
      type: Date,
      required: true
    }
  }],
  userIP: {
    type: String,
    required: true
  },
  duration: {
    type: Number // Duração em segundos
  }
}, {
  timestamps: true,
  collection: 'tb_cl_chat_sessions'
});

// Middleware para calcular duração antes de salvar
chatSessionSchema.pre('save', function(next) {
  if (this.startTime && this.endTime) {
    this.duration = Math.floor((this.endTime - this.startTime) / 1000);
  }
  next();
});

const ChatSession = mongoose.model('ChatSession', chatSessionSchema);

export default ChatSession;