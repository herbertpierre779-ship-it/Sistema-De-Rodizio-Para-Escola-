import { useState } from "react";
import { Search, UserPlus } from "lucide-react";

type ManualEntryProps = {
  onRegister: (name: string) => void;
};

export default function ManualEntry({ onRegister }: ManualEntryProps) {
  const [name, setName] = useState("");

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (name.trim()) {
      onRegister(name.trim());
      setName("");
    }
  };

  return (
    <div className="bg-white rounded-2xl shadow-lg border border-gray-200 p-6">
      <div className="flex items-center gap-2 mb-4">
        <Search className="w-5 h-5 text-gray-600" />
        <h3 className="font-bold text-gray-900">Aluno não reconhecido?</h3>
      </div>

      <form onSubmit={handleSubmit} className="space-y-3">
        <input
          type="text"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Digite o nome do aluno"
          className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent outline-none transition"
        />
        <button
          type="submit"
          className="w-full bg-blue-600 text-white py-3 rounded-lg font-semibold hover:bg-blue-700 transition flex items-center justify-center gap-2 shadow-md hover:shadow-lg"
        >
          <UserPlus className="w-5 h-5" />
          Registrar Manualmente
        </button>
      </form>
    </div>
  );
}
