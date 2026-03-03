import { Card, CardContent, CardHeader, CardTitle, CardFooter } from "@/components/ui/card";
import { SkillStatusBadge } from "./SkillStatusBadge";
import { Badge } from "@/components/ui/badge";
import type { TeamSkill } from "@/stores/teamSkillStore";

interface TeamSkillCardProps {
  skill: TeamSkill;
  onSelect: (id: string) => void;
}

export function TeamSkillCard({ skill, onSelect }: TeamSkillCardProps) {
  const visiblePhrases = skill.trigger_phrases.slice(0, 3);
  const remaining = skill.trigger_phrases.length - visiblePhrases.length;

  return (
    <Card
      className="cursor-pointer hover:border-primary/50 transition-colors"
      onClick={() => onSelect(skill.id)}
    >
      <CardHeader>
        <div className="flex items-start justify-between gap-2">
          <CardTitle className="text-sm">{skill.name}</CardTitle>
          <SkillStatusBadge status={skill.status} />
        </div>
      </CardHeader>

      <CardContent className="space-y-3">
        <p className="text-sm text-muted-foreground line-clamp-2">
          {skill.description}
        </p>

        {skill.trigger_phrases.length > 0 && (
          <div className="flex flex-wrap gap-1">
            {visiblePhrases.map((phrase) => (
              <Badge key={phrase} variant="secondary" className="text-xs">
                {phrase}
              </Badge>
            ))}
            {remaining > 0 && (
              <Badge variant="ghost" className="text-xs text-muted-foreground">
                +{remaining} more
              </Badge>
            )}
          </div>
        )}
      </CardContent>

      <CardFooter className="gap-3 text-xs text-muted-foreground">
        <Badge variant="outline" className="text-xs">
          v{skill.version}
        </Badge>
        {skill.effectiveness_score !== null && (
          <div className="flex items-center gap-1.5 flex-1">
            <span>Effectiveness</span>
            <div className="flex-1 h-1.5 rounded-full bg-muted overflow-hidden">
              <div
                className="h-full rounded-full bg-primary"
                style={{ width: `${Math.round(skill.effectiveness_score * 100)}%` }}
              />
            </div>
            <span>{Math.round(skill.effectiveness_score * 100)}%</span>
          </div>
        )}
        {skill.adoption_count > 0 && (
          <span>{skill.adoption_count} adoption{skill.adoption_count !== 1 ? "s" : ""}</span>
        )}
      </CardFooter>
    </Card>
  );
}
