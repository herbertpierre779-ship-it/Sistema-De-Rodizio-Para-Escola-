import { Clock, CheckCircle } from "lucide-react";

type StudentRecord = {
  id: number;
  name: string;
  time: string;
};

type StudentListProps = {
  students: StudentRecord[];
};

export default function StudentList({ students }: StudentListProps) {
  return (
    <div className="bg-white rounded-2xl shadow-lg border border-gray-200 p-6">
      <div className="flex items-center gap-2 mb-4">
        <CheckCircle className="w-5 h-5 text-green-600" />
        <h3 className="font-bold text-gray-900">Últimos Alunos Atendidos</h3>
      </div>

      <div className="space-y-3 max-h-96 overflow-y-auto">
        {students.length === 0 ? (
          <p className="text-gray-500 text-center py-4">
            Nenhum aluno registrado ainda
          </p>
        ) : (
          students.map((student) => (
            <div
              key={student.id}
              className="flex items-center justify-between p-3 bg-gray-50 rounded-lg hover:bg-gray-100 transition"
            >
              <span className="font-medium text-gray-900">{student.name}</span>
              <div className="flex items-center gap-1 text-sm text-gray-600">
                <Clock className="w-4 h-4" />
                <span>{student.time}</span>
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  );
}
