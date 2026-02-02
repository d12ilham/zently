import { Server } from 'socket.io';

let io;

export const initSocket = (server) => {
    io = new Server(server, {
        cors: {
            origin: "http://localhost:5173", // Vite default port
            methods: ["GET", "POST"]
        }
    });

    io.on('connection', (socket) => {
        console.log('User connected:', socket.id);

        socket.on('join_user_room', (userId) => {
            socket.join(`user_${userId}`);
            console.log(`User ${userId} joined their notification room`);
        });

        socket.on('join_project_room', (projectId) => {
            socket.join(`project_${projectId}`);
            console.log(`Socket joined project room: project_${projectId}`);
        });

        socket.on('leave_project_room', (projectId) => {
            socket.leave(`project_${projectId}`);
            console.log(`Socket left project room: project_${projectId}`);
        });

        socket.on('disconnect', () => {
            console.log('User disconnected:', socket.id);
        });
    });

    return io;
};

export const getIO = () => {
    if (!io) {
        throw new Error("Socket.io not initialized!");
    }
    return io;
};

export const emitToUser = (userId, event, data) => {
    if (io) {
        io.to(`user_${userId}`).emit(event, data);
    }
};

export const emitToProject = (projectId, event, data) => {
    if (io) {
        io.to(`project_${projectId}`).emit(event, data);
    }
};
