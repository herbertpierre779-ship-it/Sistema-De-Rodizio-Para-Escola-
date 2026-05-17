import { Camera, User } from "lucide-react";

type Student = {
  id: number;
  name: string;
  grade: string;
  photo?: string;
  status: "not-eaten" | "ready" | "eaten";
};

type StudentCardProps = {
  student: Student | null;
  onConfirm: () => void;
};

export default function StudentCard({ student, onConfirm }: StudentCardProps) {
  const getStatusConfig = (status: Student["status"]) => {
    switch (status) {
      case "not-eaten":
        return { color: "bg-red-500", label: "Ainda não comeu" };
      case "ready":
        return { color: "bg-orange-500", label: "Pronto para confirmar" };
      case "eaten":
        return { color: "bg-green-500", label: "Já comeu" };
    }
  };

  if (!student) {
    return (
      <div className="bg-blue-600 rounded-2xl shadow-xl p-8 text-white">
        <div className="flex flex-col items-center justify-center py-12">
          <Camera className="w-20 h-20 mb-4 opacity-50" />
          <p className="text-xl opacity-80">
            Aguardando reconhecimento do aluno
          </p>
        </div>
      </div>
    );
  }

  const statusConfig = getStatusConfig(student.status);
  const currentDateTime = new Date().toLocaleString("pt-BR", {
    dateStyle: "short",
    timeStyle: "short",
  });

  return (
    <div className="bg-blue-600 rounded-2xl shadow-xl p-8 text-white">
      <div className="flex items-start gap-6 mb-6">
        {/* Foto do Aluno */}
        <div className="w-32 h-32 bg-white rounded-2xl flex items-center justify-center overflow-hidden flex-shrink-0 shadow-lg">
          {student.photo ? (
            <img
              src={student.photo}
              alt={student.name}
              className="w-full h-full object-cover"
            />
          ) : (
            <User className="w-16 h-16 text-blue-600" />
          )}
        </div>

        {/* Informações do Aluno */}
        <div className="flex-1">
          <h2 className="text-4xl font-bold mb-3">{student.name}</h2>
          <div className="space-y-2">
            <div className="flex items-center gap-2">
              <span className="text-blue-100">Série:</span>
              <span className="text-xl font-semibold">{student.grade}</span>
            </div>
            <div className="flex items-center gap-2">
              <span className="text-blue-100">Data e Hora:</span>
              <span className="font-medium">{currentDateTime}</span>
            </div>
          </div>
        </div>
      </div>

      {/* Status */}
      <div className="mb-6">
        <div className="flex items-center gap-3">
          <div className={`w-4 h-4 rounded-full ${statusConfig.color}`}></div>
          <span className="text-lg font-medium">{statusConfig.label}</span>
        </div>
      </div>

      {/* Botão Confirmar */}
      <button
        onClick={onConfirm}
        disabled={student.status === "eaten"}
        className={`w-full py-4 rounded-xl font-bold text-lg transition shadow-lg ${
          student.status === "eaten"
            ? "bg-gray-400 cursor-not-allowed"
            : "bg-white text-blue-600 hover:bg-blue-50 hover:shadow-xl"
        }`}
      >
        {student.status === "eaten" ? "ALMOÇO JÁ CONFIRMADO" : "CONFIRMAR ALMOÇO"}
      </button>
    </div>
  );
}
