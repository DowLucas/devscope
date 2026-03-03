import { Badge } from "@/components/ui/badge";

interface SkillMdPreviewProps {
  skill: {
    name: string;
    description: string;
    trigger_phrases: string[];
    skill_body: string;
  };
}

export function SkillMdPreview({ skill }: SkillMdPreviewProps) {
  return (
    <div className="rounded-lg border overflow-hidden">
      {/* Frontmatter header */}
      <div className="bg-muted px-4 py-3 space-y-2">
        <h3 className="text-sm font-semibold">{skill.name}</h3>
        <p className="text-xs text-muted-foreground">{skill.description}</p>
        {skill.trigger_phrases.length > 0 && (
          <div className="flex flex-wrap gap-1.5">
            {skill.trigger_phrases.map((phrase) => (
              <Badge key={phrase} variant="secondary" className="text-xs">
                {phrase}
              </Badge>
            ))}
          </div>
        )}
      </div>

      {/* Skill body */}
      <div className="p-4">
        <pre className="text-xs font-mono whitespace-pre-wrap break-words text-foreground/90 leading-relaxed">
          <code>{skill.skill_body}</code>
        </pre>
      </div>
    </div>
  );
}
